# Privacy policy

index-drift is an open-source command-line tool by Yaroslav Shmarov. It runs on your computer. It has no server, collects no analytics and sends nothing to its author.

## Google account data

When you run `index-drift login`, you sign in with Google and allow one permission: read-only access to Search Console (`https://www.googleapis.com/auth/webmasters.readonly`).

- **What index-drift reads:** the sitemaps submitted for your properties, the URL Inspection result for each sitemap URL, and page-level clicks and impressions from Search Analytics.
- **Where it goes:** requests go straight from your computer to Google. The results are saved only in files on your computer: the state file (by default `.index-drift/<site>.json`) and any report you ask for.
- **Your sign-in:** Google's refresh token is saved in `~/.config/index-drift/credentials.json`, readable only by your user account. It is never sent anywhere except Google.
- **No sharing, no sale, no AI training.** The author never receives this data, so it cannot be shared, sold, or used to train models.

index-drift's use of information received from Google APIs follows the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Other services

If you turn them on, index-drift also sends your sitemap URLs from your computer to Bing Webmaster Tools (`--bing`) and to IndexNow (`--indexnow-key`). Their own privacy policies apply.

## Removing access

Run `index-drift logout`. It revokes the sign-in at Google and deletes the saved file. You can also remove access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Delete the `.index-drift` folder to remove the saved results.

## Contact

Open an issue at [github.com/yshmarov/index-drift](https://github.com/yshmarov/index-drift/issues).
