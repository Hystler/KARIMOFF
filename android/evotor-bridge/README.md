# KARIMOFF Evotor Bridge

KARIMOFF Bridge pairs a physical Evotor terminal with the website POS. It keeps the existing
read-only diagnostics and preview tools and also receives website card-payment requests.

It reads:

- device and Evotor POS versions;
- installed `PaymentPerformer` components;
- payment systems and the number of configured accounts.

The hosted connection uses `https://karimoff.site` through the external-service proxy configured for
the application in the Evotor developer portal. A terminal is paired with a one-time code and
stores its revocable bearer token in private application preferences.
Evotor Cloud replaces the standard `Authorization` header, so the paired-device token is sent
as `X-Karimoff-Terminal-Token` and remains validated by its server-side HMAC digest.
For Android 11 terminals, the app also carries the official Let's Encrypt Root YE CA and the
official Evotor RootCA scoped only to the bridge domain; normal hostname and certificate
validation remain enabled. Android Network Security Config adds Root YE from
https://letsencrypt.org/certs/gen-y/root-ye.pem (SHA-256
`E14FFCAD5B0025731006CAA43A121A22D8E9700F4FB9CF852F02A708AA5D5666`) and RootCA from
https://developer.evotor.ru/attachments/rootCA2025.crt (SHA-256
`6B92EFD383746C955C42924E85BD84C2B3D11AB26BCDE2FDB2FC2C7D657FB2DF`).
It accepts only HTTPS on `karimoff.site:443` and rejects redirects. Diagnostics perform a
credential-free GET request to `/api/terminal/health`; HTTP 200 confirms the health endpoint without
pairing, receipt, or payment activity. Payment requests use separate routes and require the paired
device token.
Normal requests first use the platform `HttpsURLConnection` socket factory and hostname verifier.
On the tested Evotor 6, its network proxy presents a stable self-signed `CN=karimoff.site` certificate
without SAN. The fallback accepts only that exact leaf certificate (SHA-256
`66956E38A0DE40538063F47FBB9EBEA089381118A348BB76C129F92446804606`), only for
`karimoff.site`, after validity, self-signature, subject and TLS proof-of-key checks. It does not
trust arbitrary self-signed certificates. The client is selected only after a successful health response.
Health success requires HTTP 200 and the expected enabled health response.
If HTTPS fails, a separate credential-free TLS probe displays the peer IP, device UTC time,
and public certificate subjects, issuers, SANs, self-signature checks, validity dates and SHA-256 fingerprints.
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

## Website POS card payment

1. Generate a one-time pairing code in the KARIMOFF Evotor admin page.
2. Enter the code in the APK and pair the terminal.
3. Keep KARIMOFF Bridge open on the paired terminal so it can poll for POS requests.
4. In KARIMOFF POS, assemble the order and choose **Перейти к оплате**.
5. The server creates a non-operational order and one payment intent for the explicitly selected, cloud-bound cashbox. It queues authoritative server-priced items; the order is not in KDS yet.
6. Bridge 0.21 (version code 21) saves the local receipt UUID before invoking the electronic payment performer.
7. The server releases the order to KDS only after confirmed payment and complete fiscal identity (FN/FD/FP). A successful payment without that identity remains `fiscal_pending` and blocks another charge. Exact device/store and fiscal identity reconcile a later cloud SELL with the same canonical sale.

Queued, processing, fiscal-pending and uncertain orders remain outside KDS. A timeout is not a failed payment.
The authenticated bridge retains/retries its result, not a new monetary command. Manual paid resolution requires
an already imported SELL document and matching FN/FD/FP for the selected device/store. A dispatched UNKNOWN
cannot be manually cancelled to unlock the cashbox. Never retry an unknown payment before reconciling its result.

The site requires the terminal payment foundation and `20261003120000_pos_fiscal_identity.sql`, cloud binding,
enabled bridge configuration and explicit `EVOTOR_POS_PAYMENTS_ENABLED=true`. Initial deployment keeps this
payment flag OFF. `TEST_ORDER_MODE=true` disables card collection through the website POS.

## Hosted preview flow

1. Generate a one-time pairing code in the KARIMOFF Evotor admin page.
2. Enter the code in the APK and pair the terminal.
3. Queue a test preview from the admin page.
4. Tap **Получить тестовый заказ** on the terminal.

The preview remains display-only and does not create a receipt, change an order, print, or invoke a
payment component.

## Manual payment-screen probe

The diagnostics screen has a separate **Проверить экран оплаты · 1 ₽** action. It refuses to replace
an existing open sale receipt, then opens a one-ruble draft and the Evotor payment-method screen. It
does not select a payment method or submit a transaction. To verify the card screen, stop at the
terminal prompt and cancel before presenting a card; if Evotor leaves the draft open, clear it in the
cash-register UI. Completing this draft would be a real sale and may create a fiscal receipt. This
probe is local to the terminal and does not send a website POS order or release anything to the kitchen.
