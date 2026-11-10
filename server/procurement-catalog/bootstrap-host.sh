#!/usr/bin/env bash
# Explicit deployment on an already-accessible Ubuntu x64 host. No OS reinstall.
# Stage app/, config.json, publisher.pub, sqlite3_rsync and cloudflared in
# /root/catalog-deploy before running. Credentials never enter Git or argv.
set -euo pipefail
catalog_workspace=${1:?Workspace ID required}
catalog_release=${2:?Code release ID required}
[[ $EUID == 0 && $(uname -m) == x86_64 ]]
[[ $catalog_workspace =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,180}$ && $catalog_release =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,180}$ ]]
if ! command -v curl python3 tar xz >/dev/null || [[ $(dpkg-query -W -f='${Status}' libatomic1 2>/dev/null || true) != 'install ok installed' ]]; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends ca-certificates curl python3 xz-utils libatomic1
fi
catalog_stage=/root/catalog-deploy
python3 - "$catalog_stage/config.json" "$catalog_workspace" <<'PY'
import json,sys
with open(sys.argv[1]) as stream: config=json.load(stream)
assert config['root']=='/srv/procurement-catalog'
assert len(config['workspaces'])==1 and config['workspaces'][0]['societyId']==sys.argv[2]
assert config['workspaces'][0]['folder'].startswith('Zoer/bc-bid-monitor/'+sys.argv[2])
PY
if ! id catalog-publisher >/dev/null 2>&1; then
  if getent passwd 10001 >/dev/null; then printf '%s\n' 'UID 10001 is already used; inspect before provisioning.' >&2; exit 1; fi
  useradd --system --uid 10001 --user-group --home-dir /var/lib/procurement-catalog --create-home --shell /bin/sh catalog-publisher
fi
if ! id cloudflared-catalog >/dev/null 2>&1; then useradd --system --user-group --no-create-home --shell /usr/sbin/nologin cloudflared-catalog; fi
install -d -m 0755 /opt/procurement-catalog /opt/procurement-catalog/releases /opt/procurement-catalog/tools /usr/local/libexec
if [[ ! -x /opt/procurement-catalog/node/bin/node ]]; then
  catalog_install_tmp=$(mktemp -d /opt/procurement-catalog/.node-install-XXXXXX)
  trap 'rm -rf "$catalog_install_tmp"' EXIT
  curl --fail --silent --show-error --location --proto '=https' https://nodejs.org/dist/v26.7.0/node-v26.7.0-linux-x64.tar.xz -o "$catalog_install_tmp/node.tar.xz"
  printf '%s  %s\n' '982aa24dd8be4c889c6a8ab337ddff3b0896645b20f4239356e80552c16277ee' "$catalog_install_tmp/node.tar.xz" | sha256sum -c -
  tar -xJf "$catalog_install_tmp/node.tar.xz" -C "$catalog_install_tmp"
  mv "$catalog_install_tmp/node-v26.7.0-linux-x64" /opt/procurement-catalog/node-v26.7.0-linux-x64
  ln -s node-v26.7.0-linux-x64 /opt/procurement-catalog/node
fi
[[ $(/opt/procurement-catalog/node/bin/node --version) == v26.7.0 ]]
install -m 0755 "$catalog_stage/sqlite3_rsync" /usr/local/libexec/sqlite3_rsync-3.54.1
[[ $(/usr/local/libexec/sqlite3_rsync-3.54.1 --version) == '2026-10-16 14:45:20 555e07ef33f69a0957d24d8e555b702464a131d6f1607f4c3c1e4551e8e6ca76' ]]
install -m 0755 "$catalog_stage/cloudflared" /opt/procurement-catalog/tools/cloudflared
/opt/procurement-catalog/tools/cloudflared --version
install -d -m 0711 /etc/procurement-catalog
install -m 0640 -o root -g catalog-publisher "$catalog_stage/config.json" /etc/procurement-catalog/config.json
install -m 0640 -o root -g cloudflared-catalog "$catalog_stage/cloudflared-token" /etc/procurement-catalog/cloudflared-token
install -d -m 0700 -o catalog-publisher -g catalog-publisher /srv/procurement-catalog
install -d -m 0700 -o catalog-publisher -g catalog-publisher "/srv/procurement-catalog/staging/$catalog_workspace"
install -d -m 0755 "/opt/procurement-catalog/releases/$catalog_release"
install -m 0644 "$catalog_stage"/app/*.mjs "$catalog_stage"/app/*.map "/opt/procurement-catalog/releases/$catalog_release/"
install -m 0755 "$catalog_stage/catalog-ssh-gateway.py" "/opt/procurement-catalog/releases/$catalog_release/catalog-ssh-gateway.py"
ln -sfn "releases/$catalog_release" /opt/procurement-catalog/current
install -d -m 0755 /etc/ssh/authorized_keys
catalog_authorized_key="restrict,command=\"/usr/bin/python3 /opt/procurement-catalog/current/catalog-ssh-gateway.py --config /etc/procurement-catalog/config.json --workspace $catalog_workspace\" $(cat "$catalog_stage/publisher.pub")"
if [[ -f /etc/ssh/authorized_keys/catalog-publisher ]] && [[ $(cat /etc/ssh/authorized_keys/catalog-publisher) != "$catalog_authorized_key" ]]; then printf '%s\n' 'A different publisher key is already installed; inspect instead of rotating it.' >&2; exit 1; fi
printf '%s\n' "$catalog_authorized_key" > /etc/ssh/authorized_keys/catalog-publisher
chmod 0600 /etc/ssh/authorized_keys/catalog-publisher
catalog_ssh_stage=$(mktemp -d "$catalog_stage/.ssh-check-XXXXXX")
trap 'if [[ -n ${catalog_install_tmp:-} ]]; then rm -rf -- "$catalog_install_tmp"; fi; rm -rf -- "$catalog_ssh_stage"' EXIT
mkdir "$catalog_ssh_stage/snippets"
cat > "$catalog_ssh_stage/snippets/70-procurement-catalog.conf" <<'SSH'
Match User catalog-publisher
  AuthorizedKeysFile /etc/ssh/authorized_keys/catalog-publisher
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  PermitTTY no
  DisableForwarding yes
Match all
SSH
python3 - "$catalog_ssh_stage" <<'PY'
from pathlib import Path
import re,shutil,sys
stage=Path(sys.argv[1])
for source in Path('/etc/ssh/sshd_config.d').glob('*.conf'):
    if source.name!='70-procurement-catalog.conf': shutil.copy2(source,stage/'snippets'/source.name)
original=Path('/etc/ssh/sshd_config').read_text()
candidate,count=re.subn(r'(?m)^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf\s*$', 'Include '+str(stage/'snippets'/'*.conf'),original)
if count!=1: raise RuntimeError('Cannot validate the exact SSH include layout; no configuration replaced.')
(stage/'main').write_text(candidate)
PY
# Validate the complete future include layout before changing the live file.
# A concurrent OS updater must never encounter an unvalidated SSH snippet.
/usr/sbin/sshd -t -f "$catalog_ssh_stage/main"
catalog_ssh_install=$(mktemp /etc/ssh/sshd_config.d/.catalog-validated-XXXXXX)
install -m 0644 "$catalog_ssh_stage/snippets/70-procurement-catalog.conf" "$catalog_ssh_install"
mv -f -- "$catalog_ssh_install" /etc/ssh/sshd_config.d/70-procurement-catalog.conf
/usr/sbin/sshd -t
systemctl reload ssh
install -m 0644 "$catalog_stage/procurement-catalog.service" "$catalog_stage/cloudflared-catalog.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable procurement-catalog.service cloudflared-catalog.service
systemctl restart procurement-catalog.service
systemctl restart cloudflared-catalog.service
systemctl is-active procurement-catalog.service cloudflared-catalog.service
