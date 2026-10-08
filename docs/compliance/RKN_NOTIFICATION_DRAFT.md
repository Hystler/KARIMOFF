# Draft: notification to Roskomnadzor

Prepared from the KARIMOFF source tree on 2026-10-08. **Preparation only. This document has not been filed.** Confirm every `UNKNOWN` with the operator and counsel before copying values into the official form. Source-code configuration does not prove a production system is enabled or where its data is stored.

The duty to notify is assessed as **YES**: the application contains automated processing of customer, lead/candidate, and staff personal data; the statutory exceptions in Article 22(2) do not appear to fit the observed online processing. Confirm whether an earlier notice exists and whether it needs amendment. [152-FZ, Article 22 (edition dated 26 July 2026)](https://www.consultant.ru/document/cons_doc_LAW_61801/d996966e22e1320c9de1ab82d9f6be12c3d9d765/).

## OPERATOR

- **Name:** Individual Entrepreneur Karimov Rustam Radikovich — taken from `src/lib/legal.ts`; owner must confirm current status and operator identity for each activity.
- **INN / OGRNIP:** `026824268433` / `322028000033524` — code values; confirm against current registry records.
- **Legal address:** `453118, Republic of Bashkortostan, Sterlitamak, Khudaiberdina St., 139, apt. 140` — code value; confirm current.
- **Other registered address:** `Moscow Region, Shchyolkovo, Potapovsky microdistrict, 1, building 1, apt. 111` — its role in the official notice is **UNKNOWN**.
- **Operator's responsible person for data protection:** **UNKNOWN** (name, role, phone, postal address, email). Public legal contact in code: `rustam.karimov.17@inbox.ru`; confirm that it is the designated contact.

## PURPOSES

Operations below reflect the application code. Add, remove, or split purposes to match actual business processes and the operator's contracts.

### 1. Registration, account access, and account security

- **Categories of subjects:** customers and registered users.
- **Personal data categories:** name, phone number, provider account identifier for user-selected Telegram/MAX login, verified-phone status used during linking, Telegram Bot recipient identifier used for order-status messages, authentication/session identifiers, and limited security event data. Username, social avatar, email and other social profile metadata are not retained after minimization.
- **Legal basis:** contract or steps at the user's request before entering the service contract; statutory/security basis only for the applicable security records. Do not list consent as the basis for ordinary account creation merely because a user created an account.
- **Operations:** collection, recording, structuring, storage, use, authentication, account linking, session issue/revocation, access restriction, and deletion/anonymization where permitted.
- **Method:** automated.

### 2. Receiving, paying for, fulfilling, and supporting customer orders

- **Categories of subjects:** customers and order recipients.
- **Personal data categories:** name, phone, order identifier/number, order contents, amount, order/payment/fiscal statuses, receipt email where supplied, delivery address and delivery instructions where delivery is selected, and correspondence necessary to support the order.
- **Legal basis:** contract performance and steps at the customer's request before contract conclusion; applicable statutory duties for accounting, payment, and fiscal records; security basis for relevant logs.
- **Operations:** collection, recording, storage, address validation against the configured allowlist, order creation, use, transfer of the data needed for payment/receipt/delivery, customer support, restriction, and deletion/anonymization subject to mandatory recordkeeping.
- **Method:** automated with limited mixed/manual handling for fulfillment and support.

### 3. Voluntary loyalty-program participation

- **Categories of subjects:** customers who explicitly join KARIMOFF Bonus.
- **Personal data categories:** customer/account identifier, name, loyalty-card identifier, balance, and transaction/order-linked bonus records. Birthday is optional only if collected in the live flow; current production use is **UNKNOWN**.
- **Legal basis:** the participant's separate acceptance of the current program rules and the program agreement; legal retention duties for financial/order evidence where applicable.
- **Operations:** collection, recording, storage, calculation, accrual/reversal, display to the participant, and deletion/anonymization when permitted.
- **Method:** automated, with manual support/admin actions.

### 4. Responding to general customer inquiries

- **Categories of subjects:** people submitting a general/B2B/other inquiry.
- **Personal data categories:** name, phone, interest/topic, and optional comment.
- **Legal basis:** steps taken at the person's request before a possible contract and response to that request. The form presents the Privacy Policy; it does not require a generic personal-data consent for this purpose.
- **Operations:** collection, recording, storage, review, contact, closure, and deletion/anonymization when no remaining purpose or legal hold applies.
- **Method:** automated collection and mixed/manual response.

### 5. Reviewing franchise applications and career candidates

- **Categories of subjects:** franchise applicants; job applicants/candidates.
- **Personal data categories:** name, phone, interest, and optional comment. Additional email, city, resume, or vacancy data are described in some legal text, but whether those fields are currently collected is **UNKNOWN** and must be reconciled before filing.
- **Legal basis:** separate purpose-specific franchise or careers consent evidenced by document version, timestamp, source, subject, and affirmative action. Any other basis must be separately confirmed by the operator.
- **Operations:** collection, recording, storage, review, contact, decision-making, restriction, and deletion/anonymization after the purpose ends subject to required retention.
- **Method:** automated intake with mixed/manual review.

### 6. Voluntary marketing preference

- **Categories of subjects:** customers and inquiry submitters who affirmatively opt in to a marketing purpose.
- **Personal data categories:** account/lead identifier, phone and/or email available for a selected channel, granted/revoked state, source, timestamp, and document version.
- **Legal basis:** separate prior consent for the particular marketing purpose/channel. Current code stores a preference; source review did not find an active advertising-message dispatch integration. Do not describe outbound campaigns as live until verified.
- **Operations:** recording, storage, use as a suppression/eligibility preference, revocation, and deletion/anonymization where permitted.
- **Method:** automated.

### 7. Website operation, cookies, fraud prevention, and information security

- **Categories of subjects:** site visitors, customers, and staff users.
- **Personal data categories:** necessary session/cookie identifiers, cookie choice identifier and category selection, IP/user-agent only where collected by the active runtime, authentication/security event data, and staff account/role/access/action data.
- **Legal basis:** contract/service delivery for necessary site functions; separate consent for optional cookie categories when such technologies are introduced; statutory duties and the operator's security obligations/legitimate security interests for necessary security records.
- **Operations:** collection, recording, storage, access control, monitoring, investigation, restriction, and deletion/anonymization.
- **Method:** automated, with mixed/manual security response.

## SECURITY MEASURES

Implemented or present in source: role/access checks for staff areas, session tokens stored as hashes, session expiry/revocation, CSRF/same-origin checks on sensitive mutations, password hashing, encrypted social OAuth state, restricted database grants/RLS in migrations, audit/security event logging, HTTPS/HSTS configuration, and dependency/application controls.

**UNKNOWN / verify before filing:** actual production encryption-in-transit settings for database and object storage; cryptographic tools and their names; production role grants and RLS state; backup encryption/access/restore/deletion controls; secrets rotation; active log retention and access review; physical/data-center controls; approved protection-level model and threat model; and whether every referenced migration was applied. Do not represent these code patterns as verified production controls.

## DATA PROCESSING START DATE

**UNKNOWN.** Determine the first date each purpose began in any channel (site, manual forms, email, POS, social login, staff/admin systems). Repository migration dates are not proof of the real-world start date.

## TERMINATION CONDITION

Use purpose-specific wording, not a made-up number of years: processing ends when the stated purpose is achieved or the contract/communications end, consent is withdrawn where consent is the basis, and any applicable statutory retention period, accounting/fiscal duty, claim period, or legal hold no longer requires preservation. The concrete retention schedule and event for each category are **UNKNOWN** and need operator/accounting/legal approval.

## DATABASE LOCATION

**UNKNOWN.** Runtime PostgreSQL connection is configured externally; source code does not establish its country, city, data-center address, replicas, backup locations, or support-access geography. S3-compatible storage, if enabled, is configurable and its actual region/endpoint is unverified. Confirm primary database, replicas, backups, object storage, logs, uploaded files, and monitoring destinations from provider contracts and account consoles.

## CROSS-BORDER

**UNKNOWN — do not report `NONE` from source code alone.** Code has outbound/inbound integrations for YooKassa and user-selected Telegram/MAX authentication. The country of the relevant legal entity, actual processing location, onward recipients/subprocessors, and enabled production configuration have not been verified. Determine each destination and recipient from contracts and live account configuration; assess and complete any separate statutory cross-border steps before enabling/declaring a cross-border flow.

## PROCESSORS / RECIPIENTS

- **YooKassa:** payment/receipt API is implemented. Source sends order/payment identifiers, amount, order composition and receipt email for payment/receipt operations. Merchant/acquirer/fiscal-chain entities, legal entities, data locations, and contractual roles are **UNKNOWN**.
- **Telegram and MAX:** selected social-auth code validates provider identity/phone claims. KARIMOFF retains the provider ID for login/linking/duplicate protection, verified phone on the customer account, and the signed Telegram Bot recipient ID for order-status notification. Other username/avatar/email/profile claims are not persisted. Confirm provider legal entities, processing countries, and downstream recipients; do not classify a service as cross-border from its name alone.
- **Telegram Bot API:** when configured, code can send order-ready/cancelled notices using the retained signed recipient ID and order number/status. Confirm whether enabled, legal entity/country, processing basis, and provider retention.
- **PostgreSQL, backups, S3-compatible storage, logs/monitoring/CDN:** actual services, account/resource identifiers, locations, access, and subcontractors are **UNKNOWN**. The app has a configurable database adapter and optional external-storage code paths; this does not prove which services are active.
- **Email/SMS:** no production SMS adapter or advertising dispatch was found in the reviewed code; verification-code sending fails closed when no supported adapter exists. Confirm if any external platform handles mail, support, notifications, or manual exports outside this repository.
- **Evotor / POS terminals / fiscal and delivery parties:** code contains integration paths, but whether personal data are sent through a given path in production, and each recipient's role and location, are **UNKNOWN**. Inspect contracts and enabled configurations.
- **Analytics/crash monitoring:** no active external web-analytics or crash-monitoring SDK was found in the reviewed application source. Confirm platform-level/CDN/hosting logs and any out-of-repository scripts.

## UNKNOWN — OWNER INPUT REQUIRED

1. Confirm whether the operator already has RKN registration/notice and its number; determine whether this is a new notice or amendment.
2. Provide the real processing start date for every purpose.
3. Confirm primary/replica PostgreSQL location and database-backup locations.
4. Confirm application/security log locations and retention.
5. Confirm S3 endpoint, bucket region/location, and uploaded-file location; confirm any candidate uploads outside this code.
6. Identify actual processors/recipients, their roles/legal entities, processing countries, and onward recipients, including hosting, payment/fiscal, Telegram/MAX auth and notification, delivery, support, email/SMS, monitoring/CDN.
7. Approve enforceable retention and termination conditions by data category and identify statutory records/legal holds.
8. Confirm the responsible contact's name, role, phone, address, and email.
9. Confirm which candidate/franchise fields are actually collected and reconcile policy with production.
10. Confirm deployed technical/organizational measures, encryption/tools, access rights, backup access/deletion, and incident contacts.

No notification was sent and no official form was submitted as part of this branch work.
