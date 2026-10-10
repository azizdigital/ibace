# IbACE

**Digital Operation Toolkit** for the Irong Barat crew. An offline web app (PWA) that
installs to a phone or tablet from GitHub Pages and then works with no connection.

Version 3.5.2. No frameworks, no build step, no server code: the files in this folder
are the whole app.

## What it does

| Tab | What is in it |
|---|---|
| **Home** | Today's rotation day, one card for every lock in use (tap to list them; lock box warnings show under it), six shortcuts, Send to admin |
| **Locks** | The two registers, switched at the top: **OIM padlocks** (Issue, Lock with photo proof, Return) and **Prod locks** (Take, Return). Every lock goes in a lock box |
| **Tools** | Three cards: Health Declaration, OT calculator, Calculators (tap to show the twelve calculator cards) |
| **Me** | Rotation calendar, daily log, concern reports. Personal: kept on the phone only |
| **Menu** (top right) | Send to admin, Sync with another phone, Export for OIM Assist, PDF report, Settings |

## Put it on GitHub Pages

1. Create a **public** repository, for example `azizdigital/ibace`.
2. Upload **everything in this folder** to the root of the repository, including the
   `icons` folder and the empty `.nojekyll` file. `index.html` must be at the top level.
3. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a
   branch**, branch `main`, folder `/ (root)`, **Save**.
4. After a minute or two the app is at `https://azizdigital.github.io/ibace/`
   (your user name, then the repository name).

If you name the repository something else, the address changes with it. The user guides
print `https://azizdigital.github.io/ibace/`; if the real address is different, the
guides need rebuilding.

## License keys

The whole app is locked until a license key is entered once on the device.

- A key is made for **one named person** with the key maker. Keys do not expire.
- The person copies the key (or the whole WhatsApp message it came in) and pastes it
  into "Enter your license key". There is no activation link. After that the key is
  remembered; **Reset all data** keeps it.
- **1000 licences.** Every key carries a number from 1 to 1000 (`LICENSE_MAX` in
  `license.js`), and the app refuses any key numbered outside that. The key makers stop
  when every number has been given out. To allow more later, raise `LICENSE_MAX` here
  and `LIMIT` in the Key Maker page, then release an update.
- The holder's name, key ID and number show in **Settings** ("Licensed to"). The name
  and key ID go out in the export file (`licensedTo`, `licenseId`), the sync file and
  the Send to admin message, so the admin can tell whose installation a file came from.
  The key itself is never exported.
- To cancel a key, add its 6-character ID to `LICENSE_REVOKED` in `license.js` and
  release an update. It takes effect on a phone when that phone updates.

### Where keys are made

Only in two places, both the owner's:

1. **The owner's two laptops** (Laptop 1: numbers 601 to 800; Laptop 2: 801 to 1000): `IbACE-Key-Maker.html` in the `ibace-license-tool` folder.
   That folder holds the private signing key and is **never** uploaded here.
2. **The owner's phones**, up to four with 150 numbers each (Phone 1: 1 to 150; Phone 2: 151 to 300;
   Phone 3: 301 to 450; Phone 4: 451 to 600): a hidden key maker inside the app (`admin.js`), opened by
   tapping **Version** in Settings five times. It does nothing by itself. The owner
   first makes an *admin code* on the computer (the private key locked with a
   passphrase: PBKDF2-SHA256, 600,000 rounds, then AES-GCM), pastes it into that screen
   once, says which phone it is (Phone 1 to 4), and from then on
   enters the passphrase each time. The phone stores only the
   locked code. Nothing secret is in `admin.js`; anyone else who finds the screen has
   neither the admin code nor the passphrase.

Each device has its own block of numbers (`ADMIN_RANGES` in `admin.js`, `RANGES` in the
Key Maker page), so no two devices can give the same number even if their lists are
never merged. Number 1 is the owner's own key. Each device keeps its own list;
download the list on one and load it on the others to see every key in one place.

A key can be removed from a list, and a list can be reset, in either key maker. That
only changes the owner's record: the key keeps working until its ID is added to
`LICENSE_REVOKED`. The key maker shows the finished `LICENSE_REVOKED` line to paste.

What it is: a key is signed with a private key that only the owner holds; `license.js`
has only the public key, so reading this code does not let anyone make a working key.

What it is not: the check runs on the device and this code is public. Someone who edits
a copy can remove the check, and a key that is passed on works on another phone. There
is no server, so the app cannot report who is using it; the owner knows from the list
of keys issued. The 1000 limit is kept by the key makers and by the number inside each
key; it counts keys made, not phones using them. It is a gate for ordinary users, not
copy protection.

## Install on a phone (needs internet once)

1. Open the address in **Chrome** (Android) or **Safari** (iPhone, iPad).
2. Android: menu → **Install app** / **Add to Home screen**.
   iPhone or iPad: Share → **Add to Home Screen**.
3. Open IbACE from the new icon while still online and wait for
   "IbACE is saved on this device and works offline".

The app also offers this itself: after the license key is accepted, a banner at the top
shows an **Install** button (Android, desktop Chrome and Edge) or the Share → Add to
Home Screen steps (iPhone and iPad, where a web page is not allowed to open the install
dialog). **Not now** hides it; Install stays in the menu.

From then on it runs with no connection. There is no internet offshore, so install and
update onshore.

## Releasing an update

1. Change the files.
2. Raise the version in **two** places, to the same number:
   `APP_VERSION` in `app.js` and `CACHE_VERSION` in `service-worker.js`.
   Without this, phones keep the old files.
3. Upload the changed files to the repository.
4. On each phone, with internet: menu → **Settings → Check for update**, then close and
   reopen the app.

A phone that is offshore keeps the version it has until it is next online.

## What is public, and the OIM password

The repository is public, so anyone who knows the address can open the app and read its
code. Nobody else's phone data is visible: every record stays on the phone that made it.

- The OIM password is **not** written in the code. Only a salted SHA-256 hash is
  (`OIM_PASSWORD_HASH` in `app.js`).
- It is still a soft gate. The check runs on the phone, so a person who edits the code
  can bypass it, and a weak password can be guessed from its hash. It stops casual
  misuse; it is not real security. Do not rely on it for anything that matters.
- The admin WhatsApp number, platform names and the Health Declaration address are
  readable in the code.

To change the OIM password, work out the new hash and put it in `app.js`:

```
node -e "console.log(require('crypto').createHash('sha256').update('ibace-oim:' + 'NEW PASSWORD HERE').digest('hex'))"
```

Then release an update as above.

## Files

| File | What it holds |
|---|---|
| `index.html` | The page: header, menu, the five views, bottom tabs |
| `styles.css` | All styling, light and dark |
| `license.js` | License key check and the install banner |
| `admin.js` | The owner's hidden key maker (useless without the owner's admin code and passphrase) |
| `app.js` | OIM padlock register, storage, export for OIM Assist, Send to admin, password check |
| `ops.js` | Prod locks register, tab switching |
| `lockbox.js` | Lock boxes shared by both registers |
| `home.js` | Home screen |
| `sync.js` | Sync with another phone |
| `tools.js` | Tools tab: Health Declaration link, OT calculator, twelve calculators |
| `me.js` | Me tab: rotation, calendar, daily log, concern reports |
| `settings.js` | Settings and Reset all data |
| `report.js` | PDF report |
| `service-worker.js` | Keeps the app available offline |
| `manifest.webmanifest`, `icons/` | Name and icons for the home screen |

## Locks

**OIM padlocks** (40): Issue → Lock (photo required, or a reason plus the OIM password)
→ Return. Reset needs the OIM password.
**Prod locks** (Prod-01 to Prod-30): Take → Return. No photo or password needed. To
change the list, edit `OPS_LOCK_IDS` in `ops.js`.

### Lock boxes

| Platform | Boxes |
|---|---|
| IbA | IbA-GB01 to IbA-GB60 |
| IbB | IbB-GB01 to IbB-GB20 |
| IbC | IbC-GB01 to IbC-GB20 |

- One box holds **one OIM padlock and one Prod lock**. A box whose slot is taken is
  shown in grey.
- Choosing a box is required to Issue or Take.
- An OIM padlock goes into a box that already holds a Prod lock. If the box has none,
  the app asks for a reason first and saves it.
- Location and isolation are copied from the other lock in the box into empty fields.
- Changing the box of a lock that is out: Prod locks freely, OIM padlocks with the OIM
  password. Changes are kept in the history.
- Returning a Prod lock while the OIM padlock is still in the box shows a warning.
- After a sync, two locks of the same kind in one box are both kept and flagged.

To change the list, edit `LB_RANGES` in `lockbox.js`.

## Export for OIM Assist (unchanged contract)

`OIM_Padlock_Data_YYYY-MM-DD.json` and `OIM_Padlock_Photos_YYYY-MM-DD.json`, in the same
format as before. Each padlock also carries the extra fields `lockBox`, `boxOverride`
and `boxChanges`, which OIM Assist ignores. Prod locks are never in these files.

## Send to admin

End of every shift, to +60 11 7521 2736 on WhatsApp: the report is copied and the chat
opens; the operator pastes and sends, then attaches the two export files. WhatsApp
cannot receive files or photos from a link, so those are attached by hand or through
the phone's share screen. This needs a connection.

## Sync with another phone

Menu → Sync. One phone shares a file (`IbACE_Sync_<date>_<time>_<name>.txt`), the other
opens it and merges. Each lock follows whichever phone changed it last, by that phone's
clock; histories are combined; nothing is deleted. Quick Share, AirDrop and Bluetooth
move the file with no internet.

Sync carries OIM padlocks, Prod locks, lock boxes and photos. It does **not** carry
anything from the Me tab or the OT calculator.

## Tools

- **Health Declaration form** opens `https://osis.petronas.com/health-declaration/form`
  in the browser. Needs internet.
- **Twelve calculators** copied from Offshore Smart Hub with the same formulas,
  constants, rounding and result wording. They were copied, not reviewed. Known
  oddities carried over as they were:
  - Production Volume Loss takes KBD but labels the answer "barrels".
  - Chemical Injection asks for PPM and does not use it.
  - Fuel Consumption labels the base rate L/hr but divides by 24 and labels the answer L/day.
  - Crane Lifting scales capacity by 20 ÷ boom length, so a boom shorter than 20 m
    gives more than the rated capacity.
  - Natural Gas Leak combines its gas constants without unit conversion.

  Treat every result as an estimate and confirm it before acting on it.
- **OT calculator**, with a choice remembered on the phone:
  - **Staff**: hourly rate = (12 × monthly wages) ÷ (52 × Y), where Y is 39 or 42
    working hours a week; overtime at 1.5 times; wages above RM4,000 are counted as
    RM4,000. Hours are entered whole (a monthly balance of more than 15 minutes counts
    as one hour; the person rounds before entering). Rest days and public holidays are
    not worked out for staff.
  - **Non-staff (Employment Act 1955)**: hourly rate = monthly salary ÷ 26 ÷ 8; normal
    day × 1.5, rest day × 2, public holiday × 3.

  The figures are kept on that phone only. It is an estimate; the payslip decides.

## Me (personal, stays on the phone)

- **Rotation**: 14 days off, 14 days on. Default: off 1 to 14 July 2026, on duty 15 to
  28 July 2026, and so on. Each person can change the start date (the opposite crew
  starts 14 days later). The default is `ME_ROTATION_DEFAULT` in `me.js`.
- **Daily log**: one entry per day, saved as it is typed, shareable when the owner
  chooses.
- **Report a concern or highlight**: title, date and time, platform, module or area,
  description, and optionally action taken, way forward and up to three photos. Saved
  as a draft offline. Sending copies the message below and opens the admin's WhatsApp
  chat; photos go through the phone's share screen.

  ```
  *Operation Concern / Highlight*

  Dear OIM / OS,

  *Title:* ...
  *Date:* 09/10/2026 at 06:00
  *Platform:* Irong Barat A (IbA)
  *Module/Area:* ...

  *Description:*
  ...

  *Action Taken:*        (left out when empty)
  ...

  *Way Forward:*         (left out when empty)
  ...

  *Photos:* 2 (sent separately)   (only when there are photos)

  Regards,
  <operator name>
  ```

None of this is in a sync file, the OIM Assist export or the Send to admin message.

## Data safety

- Everything is stored in the browser's IndexedDB on that one device.
- Clearing browser data, or removing the app on iPhone, erases it.
- **Settings → Reset all data** (OIM password, type RESET, 7-second wait) erases
  everything on that phone, including the Me tab.
- Send the export files every shift; they are the backup of the OIM padlocks.

## Not in this version

The Operations tab and the GL report tab were removed. Operators use the Operation Page
(`operation.html`) as before. `node server.js` is no longer needed.
