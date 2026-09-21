# KARIMOFF Evotor Bridge

The current build is a read-only compatibility diagnostic and order-preview receiver for the
physical Evotor terminal.

It reads:

- device and Evotor POS versions;
- installed `PaymentPerformer` components;
- payment systems and the number of configured accounts.

It deliberately has no cash-operation grants, push receiver, receipt commands, or payment commands.
The hosted preview uses HTTPS against `karimoff.site`. A terminal is paired with a one-time code and
stores its revocable bearer token in private application preferences.

## Build

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew assembleDebug
```

The APK is generated at `app/build/outputs/apk/debug/app-debug.apk`.

## Hosted preview flow

1. Generate a one-time pairing code in the KARIMOFF Evotor admin page.
2. Enter the code in the APK and pair the terminal.
3. Queue a test preview from the admin page.
4. Tap **Получить тестовый заказ** on the terminal.

The server and APK validate every payload. The bridge only renders text and acknowledges delivery; it
does not create a receipt, change an order, print, or invoke a payment component.
