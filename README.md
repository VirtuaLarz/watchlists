# Watch Lists — setup guide

Your own movie and show list app: sign in with Google, synced on every device, with TMDB search built in.
Everything here is free. Plan on 20–30 minutes, on a computer.

You'll need two downloads from the chat:
- **watchlists-app.zip** — the app (unzip it to get the `watchlists` folder)
- **watchlists-import.json** — your 16 lists, to load on first sign-in

---

## 1. Create a Firebase project (sign-in + storage)

1. Go to **console.firebase.google.com** and sign in with your Gmail.
2. Click **Create a project** (or **Add project**). Name it `watchlists`. Turn **Google Analytics off**. Click **Create project**.

## 2. Register the web app and copy its settings

1. On the project's home page, click the **Web** icon (`</>`).
2. Nickname: `watchlists`. Leave "Firebase Hosting" unchecked. Click **Register app**.
3. You'll see a code block with `const firebaseConfig = { apiKey: "...", authDomain: "...", ... }`.
4. Open **config.js** from the `watchlists` folder in any text editor (Notepad, TextEdit) and replace each `PASTE_...` value with the matching value from Firebase. Keep the quotes. Save.

These values are meant to be public; your lists are protected by the security rules in step 4.

## 3. Turn on Google sign-in

1. Left menu: **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Google** → switch **Enable** on → pick your Gmail as the support email → **Save**.

## 4. Create the database

1. Left menu: **Build → Firestore Database → Create database**.
2. Pick a location near you (e.g. `nam5 (United States)`), then **Start in production mode** → **Create**.
3. Open the **Rules** tab, delete what's there, paste the contents of **firestore.rules**, and click **Publish**.

## 5. Put the app online with GitHub Pages

1. Make a free account at **github.com** if you don't have one.
2. Top right **+** → **New repository**. Name: `watchlists`. Set it to **Public**. Click **Create repository**.
3. Click **uploading an existing file**. Drag in everything inside the `watchlists` folder:
   `index.html`, `app.js`, `styles.css`, `config.js`, and the three `.png` icons. Click **Commit changes**.
4. In the repository: **Settings → Pages**. Under "Build and deployment", Source: **Deploy from a branch**, Branch: **main**, folder **/ (root)** → **Save**.
5. After a minute or two the page shows your address: `https://YOUR-GITHUB-NAME.github.io/watchlists/`

## 6. Approve that address in Firebase

1. Firebase → **Authentication → Settings → Authorized domains → Add domain**.
2. Enter `YOUR-GITHUB-NAME.github.io` (no `https://`, no `/watchlists`). **Add**.

## 7. Get your TMDB key

1. Sign in at **themoviedb.org** → your avatar → **Settings → API**.
2. Request an API key: choose **Developer**, personal/non-commercial use, and fill in the short form (for the URL you can use your GitHub Pages address).
3. Copy the **API Key** (the shorter one). The longer "Read Access Token" also works.

## 8. First sign-in

1. Open your GitHub Pages address and tap **Sign in with Google**.
2. Tap **Load my lists from file** and choose **watchlists-import.json**. Your 16 lists appear.
3. Tap **⚙︎** (Settings), paste your TMDB key, tap **Save key**. It should say TMDB accepted it.
4. Use **+ Add** to search TMDB and add titles. They're placed in release-date order in the list you pick.

## 9. Put it on your iPhone

Open the address in **Safari**, sign in, then **Share → Add to Home Screen**.

---

## Good to know

- **Backups:** Settings → **Download a backup** saves all your lists as a file. Loading a file later replaces lists with the same name and adds any new ones.
- **Changing the app:** edit the files and upload them to the same GitHub repository again (drag in the new versions → Commit). The site updates in a minute or two.
- **Privacy:** the GitHub repository is public, but it only contains the app's code and Firebase settings, never your lists. Only your Google account can read or change your lists.
- **Costs:** Firebase's free plan and GitHub Pages cover a personal app like this. You never need to add a payment method.

### If something goes wrong
- *"Setup needed"* on the page: config.js still has `PASTE_...` values, or the edited file wasn't uploaded.
- *"This web address isn't approved"*: redo step 6 with the exact `...github.io` domain.
- *Sign-in pops up and closes with nothing happening:* allow pop-ups for the site, then try again.
- *Lists don't save or "Lost the connection"*: check that the Firestore rules from step 4 were published.
- *"TMDB didn't accept your key"*: re-copy the key from TMDB Settings → API, with no spaces.
