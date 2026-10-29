#!/bin/bash
# Publishes the latest app from GitHub to https://all-content-watchlists.web.app (run in Firebase Cloud Shell).
set -e
cd ~/wl && git pull -q
mkdir -p public && cp index.html app.js styles.css config.js *.png public/
sed -i 's/all-content-watchlists.firebaseapp.com/all-content-watchlists.web.app/' public/config.js
echo '{"hosting":{"public":"public"},"firestore":{"rules":"firestore.rules"}}' > firebase.json
firebase deploy --only hosting,firestore:rules --project all-content-watchlists --non-interactive
