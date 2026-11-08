type InstanceBrandEnvironment = {
  VITE_WORKSPACE_SYMBOL_BRAND_ID?: string;
  VITE_WORKSPACE_SYMBOL_LIGHT?: string;
  VITE_WORKSPACE_SYMBOL_DARK?: string;
};

/** Use separately supplied artwork for compact slots, never crop a wordmark. */
export function instanceWorkspaceSymbol(brandId: string | undefined, env: InstanceBrandEnvironment) {
  const localSvg = (value: string | undefined) => value && /^\/[\w/-]+\.svg$/.test(value) ? value : null;
  const light = localSvg(env.VITE_WORKSPACE_SYMBOL_LIGHT);
  if (!brandId || brandId !== env.VITE_WORKSPACE_SYMBOL_BRAND_ID || !light) return null;
  return { light, dark: localSvg(env.VITE_WORKSPACE_SYMBOL_DARK) ?? light };
}
