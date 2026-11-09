# Shared workspaces: guide for members and workspace admins

Societyer can hold several organizations, such as DDC North and First Form, side
by side. Each organization keeps its own members, roles, files and sign-in
rules. If you belong to more than one, you can reach all of them from one
sign-in and switch between them.

The words used here:

- **Login**: one way into Societyer with its own credentials, for example your
  First Form email and password, or your DDC Microsoft work account.
- **Workspace**: one organization. Your role is set separately in each one.
- **Linked logins**: two of your logins that you have proven are both yours.
  Signing in with either one shows the workspaces of both.

## Where to find it

Open the account card at the bottom of the sidebar. It has:

- **My workspaces**: every workspace you can open, with your role.
- **Sign-in methods**: how this login signs in, and the other logins linked to it.
- **Link an existing account**: join a second login to this one.
- **Account security**: two-factor authentication, when your deployment offers it.

These pages work even when no workspace is open, for example on a lock screen.

## My workspaces

**My workspaces** lists each workspace with its role and its website. A
workspace reached through a linked login says **via linked account**. Select
**Open** to go there.

A workspace that needs one more step is still listed, with the reason:

| Label | What to do |
| --- | --- |
| Needs Microsoft sign-in | Sign in with the Microsoft work account that organization gave you |
| Needs a different email address | Sign in with the email address that organization gave you |
| Needs two-factor authentication | Verify your authenticator, or set one up under **Account security** |

Invitations sent to this login's verified email appear under **Invitations**.
Select **Join** to accept one.

## Sign-in methods

**Sign-in methods** shows how this login signs in, such as **Email and
password** or **Microsoft**. You can't add or remove a method here.

To sign in with Microsoft for DDC North, ask your DDC administrator. They set up
a Microsoft login for you. If you already have a First Form login, you then link
the two (next section).

**Linked logins** lists your other logins, with their workspaces and roles.
Select **Unlink** to separate one (see [Unlinking](#unlinking)).

## Link an existing account

Use this when you joined a second organization with a different login, for
example a First Form password and a DDC Microsoft account.

Before you start:

- You need to be able to sign in to **both** logins yourself.
- Do it in one browser tab, within 10 minutes.
- Do it on a site whose sign-in page offers the second login's method. The DDC
  North site (`portal.ddcnorth.com`) only offers Microsoft. So to link a First
  Form password and a DDC Microsoft account, use the **First Form site**. Its
  sign-in page offers both a password and **Continue with Microsoft**.

Steps:

1. Sign in to one of the two logins. If you signed in more than 15 minutes ago,
   sign out and in again first.
2. Open **Link an existing account** and select **Continue**. Societyer signs you
   out of this login.
3. The sign-in page says "Sign in to the account you want to link." Sign in to
   the **other** login, the way its organization requires.
4. Check the two cards: **Started from** and **Signed in now**. Each shows the
   email address and the workspaces of that login. If you don't recognise either
   one, select **Cancel**.
5. Select **Link logins**. You'll see "Logins linked", and **My workspaces** now
   lists the workspaces of both.

What linking does and doesn't do:

- Your role in each workspace stays the same.
- Nothing is merged. Each login keeps its own password or Microsoft account and
  still works on its own.
- Each workspace still asks for its own sign-in steps. See the next section.
- A disabled membership stays disabled.
- Linking never adds you to a workspace you haven't joined.

## Why DDC North asks for Microsoft when you used a password

DDC North requires that **this sign-in** was made with a Microsoft work account
from its directory. Having Microsoft linked to you is not enough. It has to be
how you signed in this time.

So if you signed in with your First Form password, First Form opens normally and
DDC North shows **Needs Microsoft sign-in**. When you open DDC North, you'll see
"Sign in with Microsoft" and a **Continue with Microsoft for DDC North** button.
After Microsoft signs you in, DDC North opens. If your logins are linked, First
Form is available from the same Microsoft sign-in too.

A Microsoft sign-in lasts at most 8 hours. After that, sign in again.

## Switching between workspaces and websites

Use the workspace menu at the top of the sidebar. Each organization can have its
own website, for example `portal.ddcnorth.com` for DDC North and
`societyer-firstform.pages.dev` for First Form.

- On an organization's website, the sign-in page shows that organization's name
  and logo, and you land in that organization after signing in.
- Choosing a workspace that lives on another website takes you there without
  signing in again. Your browser briefly visits both sites to carry your sign-in
  across safely. You stay in the same sign-in: if it was a password sign-in, DDC
  North still asks for Microsoft.
- If the switch can't finish, you'll see "Sign in to continue". Sign in on that
  site directly.
- Signing out on one website signs out a sign-in you carried across. A sign-in
  you made separately on each site needs signing out on each.

If you open a website whose organization you don't belong to, you'll see "No
access to <organization>". It lists your other workspaces. Societyer never opens
a different organization instead without telling you. If you joined that
organization with another login, follow **Joined <organization> with a
different login? Link that account**.

## Unlinking

Open **Sign-in methods**, find the login under **Linked logins**, and select
**Unlink**. Its workspaces stop opening from this login. That login keeps working
on its own, and no roles change. You can link again later.

## For workspace admins

What you can do:

- Invite, change roles, disable (**Edit user** → status **Disabled**, or
  **Security disable**) and remove (**Remove access**) members of your
  workspace, on the **Users** page. These affect your workspace only.
- Revoke AI connector grants (**Settings → AI connectors**) and API keys
  (**Settings → API keys**).

What you can't see or do:

- Which other organizations a member belongs to, or which logins they have
  linked. Only the member sees that, in **My workspaces** and **Sign-in methods**.
- Change how members of your workspace must sign in, your workspace's website,
  or its file storage. The deployment operator sets these. Their changes appear
  in your workspace's activity history as "Deployment operator".
- Reset a member's password, or link and unlink their logins. A login can belong
  to several organizations, so these stay with the member and the operator.

Disabling someone in your workspace doesn't affect their other workspaces.
Linking can't bring a disabled member back.

If a member asks why they can't link their logins: "Can't link these logins.
Both logins are members of <workspace>." means both logins already have a
membership in your workspace. Remove the one you don't want (**Remove access**;
disabling isn't enough), then they can link. Records created by the removed
membership stay in your workspace.

## Troubleshooting

| You see | Meaning | What to do |
| --- | --- | --- |
| "Sign in with Microsoft" / "<workspace> needs you to sign in with your Microsoft work account." | You used another method this time | **Continue with Microsoft for <workspace>** |
| "Your current Microsoft sign-in doesn't give access to <workspace>. Use the Microsoft account <workspace> gave you." | A different Microsoft account, or one outside the organization's group | Sign in with the right work account, or ask the organization |
| "Microsoft sign-in was not completed. Try again." | The Microsoft round trip failed or was cancelled | Try again. If it keeps failing, your Microsoft account may not be set up for Societyer yet. Ask the organization's administrator. |
| "Use your <workspace> email" / "<workspace> doesn't accept sign-in as <email>." | The organization only accepts certain email domains | **Use another account** |
| "Two-factor authentication required" | The workspace requires an authenticator | Verify it, or set it up under **Account security** |
| "No access to <workspace>" | This login isn't a member there | Open another workspace, link the login you used there, or ask for an invitation |
| "Workspace locked" / "This sign-in can't open any of your workspaces yet." | Every workspace needs another step | See the labels in the list |
| "Sign in again first" / "For your security, linking needs a recent sign-in." | Your sign-in is older than 15 minutes | **Sign in again**, then start the link |
| "This login is disabled. Contact your administrator." | The login you are linking from is disabled | Contact your administrator |
| "Same login" | You signed in to the login that started the link | **Sign in to the other login** |
| "Link expired" / "Links last 10 minutes." | Too slow | Start again from the first login |
| "No link in progress" | Different tab, or the link ended | **Start again** |
| "Link not found" | The link was cancelled, used or replaced | Start again |
| "Already linked" | Nothing to do | See **My workspaces** |
| "Can't link these logins" … "Both logins are members of <workspace>." | Two memberships in one workspace | Ask that workspace's administrator to remove one |
| "Can't link these logins" / "One of these logins is disabled." | A login is disabled | Contact your administrator |
| "That workspace couldn't be opened on its own site. Try again, or sign in there directly." | The switch to another website failed | Try again, or go to that site and sign in |
| "Sign in to continue" / "This link expired or was already used. Sign in to continue." | The switch link was old or used | Sign in on that site |
| "Workspace access conflict" | Two of your linked logins both have a membership in one workspace, so neither opens it | Ask that workspace's administrator to remove one |
| "Account disabled" | Your membership was disabled | Contact the workspace administrator |
| "Native file storage is disabled for this workspace. …" | This organization keeps files elsewhere (DDC North uses SharePoint) | Use the document versions upload, or a document connector |
