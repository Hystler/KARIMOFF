# KARIMOFF Evotor Bridge

The current build is a read-only compatibility diagnostic and order-preview receiver for the
physical Evotor terminal.

It reads:

- device and Evotor POS versions;
- installed `PaymentPerformer` components;
- payment systems and the number of configured accounts.

It deliberately has no cash-operation grants, push receiver, receipt commands, or payment commands.
The hosted preview uses `https://karimoff.site` through the external-service proxy configured for
the application in the Evotor developer portal. A terminal is paired with a one-time code and
stores its revocable bearer token in private application preferences.
For Android 11 terminals, the app also carries the official Let's Encrypt Root YE CA scoped only
to the bridge domain; normal hostname and certificate validation remain enabled.
The per-connection TLS context combines platform anchors with the self-signed Root YE from
https://letsencrypt.org/certs/gen-y/root-ye.pem (SHA-256
`E14FFCAD5B0025731006CAA43A121A22D8E9700F4FB9CF852F02A708AA5D5666`).
It accepts only HTTPS on `karimoff.site:443` and rejects redirects. Diagnostics perform a
credential-free GET request to `/api/terminal/health`; HTTP 200 confirms the read-only cloud
channel without pairing, receipt, or payment activity.
Every bridge TLS socket explicitly sends `karimoff.site` through SNI and enables HTTPS endpoint
identification.
If HTTPS fails, a separate credential-free TLS probe displays the peer IP, device UTC time,
and public certificate subjects, issuers, validity dates and SHA-256 fingerprints.
The probe's trust manager always throws: it records unverified certificates but cannot
authorize any connection or send HTTP. It never changes the real client's trust policy.

## Build

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew assembleDebug
```

The APK is generated at `app/build/outputs/apk/debug/app-debug.apk`.

Run `sh tests/check-https.sh` with `JAVA_HOME` set for the standalone TLS integration check.
It requires internet access, sends only GET to the read-only health endpoint, and checks rejection of a wrong
hostname and an untrusted local test certificate. Run `./gradlew lintDebug assembleDebug`
for Android checks. Device-side verification is still required.

## Hosted preview flow

1. Generate a one-time pairing code in the KARIMOFF Evotor admin page.
2. Enter the code in the APK and pair the terminal.
3. Queue a test preview from the admin page.
4. Tap **Получить тестовый заказ** on the terminal.

The server and APK validate every payload. The bridge only renders text and acknowledges delivery; it
does not create a receipt, change an order, print, or invoke a payment component.
