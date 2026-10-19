FIELD GUIDE / VERSION 1.0

From starter folder  
to Kofi Collections app

A practical build guide for Quincy Swatson

A safe, staged path to turning the shared application scaffold into
artist-owned discovery, documentation, and opportunity infrastructure.

| **READ FIRST** The folder was described as “porter-starter,” while the earlier technical handoff calls it “portal-starter.” Treat the actual folder on your computer as authoritative. This guide has not inspected that folder’s contents; instructions requiring verification are marked accordingly. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# The first milestone

Open the starter in Cursor, get an inventory of what actually exists,
isolate a new Kofi project, then demonstrate a working artist profile
and searchable artwork catalog using fictional sample content. Do not
start by connecting accounts or publishing.

## Success means

- Quincy can explain what the app does and edit its content without
  depending on a developer for every step.

- An artist can control what is public, institution-visible, Kofi-only,
  or private.

- A curator can discover artists and work by medium, materials,
  dimensions, availability, career stage and relevant experience.

- Artwork records can support professional documentation; appraisals and
  insurance decisions remain with qualified humans.

Prepared as a build handoff—not an assertion that the shared starter is
secure, complete, or running.

# 01 / Your first working session

Estimated first session: 45–75 minutes, depending on software and folder
completeness. Your goal today is a safe local demo, not a live product.

## Before opening the project

1\. Find the shared folder. If it is zipped, extract it first. Confirm
the exact folder name and that it contains a package.json file. If not,
stop and tell Jordan what you see.

2\. Make a separate working copy named kofi-collections-app. Keep the
originally received folder unchanged as your recovery copy.

3\. Install or open Cursor (cursor.com) and Node.js. In the working
copy, look for .nvmrc or the “engines” field in package.json; use its
required Node version rather than guessing. Git and a private GitHub
repository can come after the first audit.

4\. In Cursor choose File → Open Folder and select kofi-collections-app.
Open the Agent panel (Ctrl+I on Windows/Linux; Cmd+Ctrl+I on Mac).

5\. Paste the READ-ONLY AUDIT PROMPT on page 5. Ask the Agent to show
the folder inventory, package scripts, integrations, security hazards,
missing files, and how to run a local mock demonstration.

6\. Read the audit summary before approving any terminal command that
could connect to a database, upload data, deploy a site, or change
external accounts.

## Safe terminal checks

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>node --version</p>
<p>npm --version</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Only after the Agent has verified package scripts, dependency lockfile,
and that no scripts touch a live database or remote service, use the
project-specific install and dev commands it recommends. A common
Next.js setup uses npm ci (when package-lock.json exists), npm run dev,
and http://localhost:3000—but these are examples until the actual
project is audited.

| **STOP SIGN** Do not run npm run build, prisma db push, prisma migrate commands, deployment scripts, or seed scripts until their effects and target databases are verified. The WLA system that inspired the starter had a potentially destructive build-time database sync. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## What to write down after session one

| **Question**              | **What Quincy records**                             |
|---------------------------|-----------------------------------------------------|
| Does the local demo open? | Yes / no; exact URL or error message                |
| What is reusable?         | Screens, uploads, validation, components, styles    |
| What is blocked?          | Missing config, unsafe auth, database, file storage |
| What is the next task?    | One small feature with testable acceptance criteria |

# 02 / Understand the Kofi product

Kofi is not merely building an online gallery. The app should help
artists document their practice, control how their work is represented,
and connect to curators and institutions that can create paid
opportunities.

| **PRODUCT LOOP** Join → create an artist profile → catalog artwork → choose visibility → become discoverable → receive opportunities → build a portable professional record. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## People this app must serve

| **User**              | **First job to make easy**                               | **Access requirement**                         |
|-----------------------|----------------------------------------------------------|------------------------------------------------|
| Artist                | Create a profile; add/edit work; determine who sees what | Own and export records                         |
| Kofi team             | Onboard artists; review listings; manage inquiries       | Role-based staff access with activity log      |
| Curator / institution | Search by needs; save shortlists; request introductions  | Verified institution gate for sensitive fields |
| Public visitor        | Discover approved artists and public work                | See only explicitly published material         |

## The first release is intentionally narrow

- Artist profiles: name/working name, bio, geography at an appropriate
  precision, mediums, portfolio links, experience and availability.

- Artwork records: images, title, medium/materials, year, dimensions and
  units, status, ownership/rights note, optional price and visibility
  choices.

- Kofi search and curator filtering: medium, material, size, career
  stage, budget range where disclosed, commission/public-art experience,
  and location/region.

- Controlled inquiry: a curator can request an introduction; artist
  contact information is not automatically exposed.

- CSV/JSON export owned by the artist and reviewable import options; no
  lock-in by design.

## Not part of the first release

AI-generated appraisals, insurance underwriting, unapproved public
publishing, payments, automated contract signing, scraping artist
content, and live CRM integrations. Those features depend on governance,
professional expertise, consent, or operational readiness.

# 03 / The build order and stage gates

Build one working user journey before expanding the menu. Each stage
should end with a live demonstration on a local or private test
environment.

| **Stage**                  | **Build / verify**                                                          | **Definition of done**                                                  |
|----------------------------|-----------------------------------------------------------------------------|-------------------------------------------------------------------------|
| 0 Safeguard the foundation | Audit starter; isolate copy; secure environment; remove WLA dependencies.   | No secrets or production connections; scripts mapped; audit documented. |
| 1 Demonstrate the idea     | Public gallery + artist and artwork detail pages using fictional seed data. | Mobile-friendly search by medium, materials and dimensions works.       |
| 2 Artist self-service      | Secure login, artist-owned edit forms, upload rules, private storage.       | Artist A cannot read or change Artist B’s unpublished records.          |
| 3 Curator workflows        | Verification, saved shortlists, controlled introduction requests.           | Curator sees authorized work, never private price/contact/docs.         |
| 4 Professional records     | Appraisal-ready dossier, consent ledger, provenance/documents, export.      | Records support human review; no automated valuation claims.            |
| 5 Partnerships and scale   | Opportunity postings, CRM, analytics, insurance referrals if justified.     | A real operational owner and funding model exist for every integration. |

## Suggested very first demo

Use 3–5 invented artist profiles with varied mediums. Put at least two
pieces of work under each profile. Show a curator filtering for a work
under a defined size, then saving an authorized shortlist. Edit one
artist profile to hide a price and prove it disappears from that
curator’s view.

## Decisions Quincy should make before stage 2

- Who approves artists and verifies curators? What is the
  appeal/correction process?

- Does an artist approve every listing, even when Kofi entered the
  record?

- How does Kofi handle sale status, pricing, commission terms, and
  direct inquiries?

- Which nonprofit/contracting entity owns the software and data
  stewardship obligations, and what is the relationship to any Forbes
  Funds-sponsored program?

# 04 / System rules to build around

## Recommended first data objects

| **Object**          | **Core fields (illustrative)**                                                     | **Guardrail**                            |
|---------------------|------------------------------------------------------------------------------------|------------------------------------------|
| Artist              | ID, working name, bio, mediums, region, stage, links, experience, visibility       | Artist controls public identity fields   |
| Artwork             | Artist ID, title, materials, dimensions+units, year, images, status, rights, price | Permissions applied to price and media   |
| Institution         | Name, verified staff contact, affiliation, purpose, approval status                | Verification before institutional access |
| Shortlist / Inquiry | Curator ID, permitted artwork IDs, date, message, status                           | No raw private contact fields            |
| Record / Document   | Artwork ID, type, custodian, date, restricted asset reference                      | Private vault; access logging            |
| Consent / Audit     | Actor, record, action, time, consent version                                       | Append-only record for sensitive actions |

## Access is field-specific, not just page-specific

| **Visibility**        | **Typical contents**                                                | **Who can see it**                    |
|-----------------------|---------------------------------------------------------------------|---------------------------------------|
| Public                | Artist-approved bio and published artwork                           | Anyone                                |
| Verified institutions | Artist-approved inquiry or pricing detail                           | Approved curators                     |
| Kofi only             | Internal onboarding / moderation notes                              | Authorized Kofi staff                 |
| Private               | Contracts, addresses, insurance docs, appraisals, nonpublic pricing | Artist and explicitly permitted roles |

Every retrieval route and file URL must enforce these permissions on the
server, not solely by hiding UI fields. Do not let private files become
accessible through guessable or permanent public links.

## Appraisal / insurance rule

Store provenance, condition notes, dimensions, images, invoices and
human appraisal documents in an appraisal-ready dossier. The application
may help assemble a packet, but should not label an AI estimate as an
appraisal or promise that acquiring art automatically increases
appraised value. Qualified appraisers, insurers and legal advisors
retain their professional roles.

| **WHY THE ORIGINAL SCAFFOLD NEEDS SCRUTINY** Earlier documentation describes inherited Credentials login, Google Drive coupling, and ineffective EXIF removal in the extracted starter. These are audit flags, not an assertion that the copy Quincy holds is identical. Confirm in code before reuse. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 05 / Copy-paste prompt: first audit

Open Cursor Agent inside the working copy. Paste the following as the
first instruction. Do not ask it to build yet.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>You are my technical guide and senior engineer for a new Kofi
Collections app.</p>
<p>I am working in a COPY of a starter folder. First, inspect ONLY; do
not edit code,</p>
<p>install dependencies, run builds, access networks, migrate databases,
or deploy.</p>
<p>1. Identify the actual project root and list its package scripts,
runtime,</p>
<p>frameworks, route structure, data model, auth, uploads, storage, env
variable</p>
<p>NAMES (never values), external services, test tooling and missing
files.</p>
<p>2. Identify what is useful for an artist catalog and curator portal
and what</p>
<p>must be removed/replaced because it belongs to WLA or Forbes
Funds.</p>
<p>3. Check for credentials auth, Google Drive links, file privacy/EXIF
risks,</p>
<p>scripts that change a database, and accidental real-service
connections.</p>
<p>4. Classify each item: KEEP / ADAPT / REPLACE / UNKNOWN with exact
file paths.</p>
<p>5. Propose the smallest SAFE way to run a fictional-data local demo
and give</p>
<p>me the exact steps in plain English. If a command can mutate external
data,</p>
<p>ask for permission before running it.</p>
<p>6. Write your report in the chat first. End with: confirmed facts,
unknowns,</p>
<p>risks, a run plan, and ONE recommended first build task.</p>
<p>Do not claim a feature is working until you have directly verified
it.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## How to use the audit

Ask the Agent to explain unfamiliar terms before approving changes. Save
its answer as BUILD_AUDIT.md in the new Kofi working folder only AFTER
you have reviewed the findings. If it cannot confirm what a command
does, skip that command.

## Next prompt: approve a bounded prototype

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>Using the audited project, create a Kofi-specific local prototype
in this</p>
<p>isolated workspace. First present a concise change plan and then
implement</p>
<p>ONE end-to-end slice: fictional artist profiles → artwork entries →
gallery</p>
<p>filters (medium, materials, size) → a detailed artwork view. Use
synthetic</p>
<p>content. Preserve working safe patterns; remove unrelated WLA
branding.</p>
<p>Do not connect to real storage, email, authentication, or production
data.</p>
<p>Add accessible mobile layouts, empty/error states, and 3 meaningful
tests.</p>
<p>Document files changed, how to run locally, the test results, and
next steps.</p>
<p>Stop and ask before destructive commands or external service
setup.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 06 / Working with Cursor without losing control

Treat Cursor as the engineering assistant; Quincy stays the product
owner. Keep the build process conversational, reviewable, and
incremental.

## The repeatable loop

1\. Describe a single user problem: “A curator should filter works by
medium and size without seeing private prices.”

2\. Ask the Agent to inspect existing code and propose the smallest
reversible change. Request exact files to be edited and the tests it
will add.

3\. Approve only changes within the isolated Kofi working copy. Review
the diff; ask what changed, what was not changed, and what might break.

4\. Run appropriate automated checks after the safety audit; manually
walk the user journey in desktop and mobile widths.

5\. Record result in BUILD_STATUS.md: working, mocked, blocked, known
risk, next task. Commit a checkpoint to a private repository after
checking no secrets or private data are staged.

6\. Invite feedback from one artist and one curator before expanding.
Track problems as observable tasks, not just wishes.

## Template for a good follow-up instruction

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>Our current task: [one observable user action].</p>
<p>Who uses it: [artist / Kofi admin / verified curator].</p>
<p>Expected behavior: [what must happen].</p>
<p>Forbidden behavior: [what must NEVER be exposed or changed].</p>
<p>Please inspect the relevant files, propose a 3–5 step plan, implement
only</p>
<p>this task after approval, add tests, and show exactly how I can
verify it.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## Common failure / first response

| **Symptom**                  | **What to ask the Agent**                                                                 |
|------------------------------|-------------------------------------------------------------------------------------------|
| Missing module               | Verify working folder, package manager, lockfile and install step.                        |
| App won’t load               | Read the exact terminal error and check missing safe config; do not paste keys into chat. |
| Login fails                  | Use authorized local mock identity; do not copy WLA accounts or bypass real security.     |
| Database command requested   | Show target database and migration effect; do not run until isolated.                     |
| Image is visible when hidden | Check server authorization and file URL policy; treat as release blocker.                 |

# 07 / Verify the product before sharing

Use fictional test records until Quincy has a real consent and data
stewardship policy. “Looks good on my computer” is not sufficient for an
artist-facing portal.

## Minimum acceptance checks

- Artist profile and artwork title save, edit, and display correctly;
  dimensions and units sort/filter as expected.

- Private prices, contact information and documents remain inaccessible
  to public visitors and unauthorized curators, including via direct
  URLs or APIs.

- Artist A cannot edit or download Artist B’s restricted content; Kofi
  admins have traceable access.

- Upload rejects unsupported/oversized files, removes sensitive image
  metadata, and stores assets privately.

- Search is usable by keyboard, labels are readable, mobile layout does
  not overflow, and error messages explain what to do.

- All demo screenshots and exports are clearly labeled fictional; there
  is a way for an artist to export their data.

- Tests, lint/type checking and build checks pass in a disposable
  environment after scripts are reviewed; no production data is touched.

## The 10-minute demonstration script

1\. Open the public gallery and filter by “painting” plus a chosen size
range.

2\. Open the result and show materials, dimensions, status and artist
bio.

3\. Switch to an authorized artist session and hide that work’s price.

4\. Switch to a curator session and prove that private price is no
longer disclosed.

5\. Save a curator shortlist or explain its precise next-stage
milestone; do not present a mock as complete.

## Share this status with Jordan

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p>What is actually running: ...</p>
<p>What is still a mock: ...</p>
<p>One working link or local demo path: ...</p>
<p>What I tested, with results: ...</p>
<p>Biggest blocker / decision needed: ...</p>
<p>Next user story I want to build: ...</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **RELEASE GATE** Do not invite real artists, institutions, or investors into a publicly accessible application until security, consent, rights, privacy and support ownership are reviewed. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 08 / Ownership, ethics and next decisions

## Keep artist agency central

- Artists retain ownership of their work and underlying copyright unless
  a separate, explicit agreement says otherwise. The portal receives
  only the licenses needed to display authorized content.

- Artists should be able to correct, withdraw and export their records.
  Removal from public search should not require deleting necessary
  financial/audit records, but retention must be explained.

- Paid opportunities and compensation should be tracked separately from
  exposure metrics. Avoid rankings that reinforce existing institutional
  visibility bias.

- Use a documented curator verification process and meaningful human
  review for opportunity matches, appraisals and sensitive institutional
  introductions.

## Keep Kofi and Forbes Funds boundaries clear

The Kofi-specific application should have its own workspace,
environments, accounts, access policies and data. The Forbes Funds
Workbench, WLA Outreach and Kofi Collections serve different users and
purposes. A future integration should be approved and documented, not
assumed because the apps share a starting scaffold.

## Five concrete decisions to make next

1\. Brand/product name, audience, and what “Kofi approved” means on
artist listings.

2\. Legal controller/steward for artist data; hosting budget; support
owner; incident contact.

3\. Artist onboarding and curator verification requirements, including
consent language.

4\. Price visibility, brokerage/commission policy and how paid
opportunities get recorded.

5\. What validates phase 1: e.g., feedback from artists/curators and
successful permission tests—not just page count.

## Sources and scope

Basis: September 2026 Kofi Collections concept discussions;
WLA_APP_ARCHITECTURE_HANDOFF.md (13 Oct 2026);
Forbes_Funds_Cursor_Opus_Kickoff.md (13 Oct 2026); Kofi/Creative
Inclusive Fund working program materials. Setup references:
cursor.com/help/getting-started/first-project;
nextjs.org/docs/app/getting-started/installation;
docs.prisma.io/docs/cli/migrate/dev and /deploy. Actual starter contents
were not supplied for direct audit.

If Quincy shares a ZIP or repository snapshot of his exact starter, the
next edition can replace conditional setup advice with verified file
paths, commands, and screenshots.
