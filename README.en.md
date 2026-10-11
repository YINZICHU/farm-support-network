# Farm Support Network

A standalone template for coordinating short, verified farming tasks. Residents do not need accounts: coordinators register requests after checking consent, task scope and timing. Administrators invite named coordinators and assign village-scoped access. Candidate matching is deterministic; it never accepts work or infers consent on anyone's behalf.

Originally developed for Care in Farming Seasons by Yin Zichu. This template does not connect to that project's website, production service or data. Reusing software is not evidence of community adoption or improved health outcomes.

Use Node 24.19.0 and pnpm 11.19.0. Run `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm demo`. Open the loopback URL and privately open the temporary account file shown in your terminal. All demo details must be fictional. There is no shared password. See [quick start](docs/quick-start.md).

Configure [project.json](config/project.json) before initialization, then rebuild and restart. Optional contact/site links are hidden when absent. Seed village IDs must stay stable after initialization. A stale client configuration or changed seed ID set is refused, never silently reset. Authorized runtime additions are stored in the encrypted village registry; adding one does not require a configuration edit or redeployment.

The workspace has Chinese and English interfaces. Resident names, notes and evidence are not translated. Project administrators can create villages or explicitly delegate creation and village management to admin/coordinator accounts. New villages start PREPARING with one job per half-day; renaming preserves IDs, and pausing preserves history and safe closure of existing work. Ordinary coordinators cannot expand their own access. The role-specific Operations Guide explains daily work, account boundaries and operator-managed backups.

Public tools are at `/zh/tools/` and `/en/tools/`: 10 unchanged, audited originals, including the blank friction planning workbook, bilingual friction frameworks, farming calendar, health guides and navigation cards. Chinese originals remain clearly labeled in English. Nine of 19 candidates are withheld; see the [review record](docs/tool-resource-review.json) and [tools usage](docs/tools-usage.en.md). Local medical and transit information must be checked before reuse. Public tools do not expose private business data.

The [blank CSVs](templates/people.csv) are offline preparation sheets, not a batch import feature. [API examples](templates/examples/person-create.json) contain fictional values and unconfirmed consent. The [API](docs/api.md) uses your own same-origin authenticated session, village permissions, version checks and idempotency keys. It is not an anonymous or cross-origin public API.

Production supports Linux, one instance/writer and a persistent mount at `/var/data/farm-support`. It starts empty and PREPARING. Your verified administrator must activate their own account and enroll MFA. Read [deployment](docs/deployment.md), [account operations](docs/identity-operations.md), [backup and recovery](docs/operations.md). Verify authorization, storage and isolated recovery before accepting real data. Each operator is responsible for consent, service safety and independent backups; CI is not operational approval.

No diagnosis, medical advice, emergency dispatch or payment processing. In a medical emergency in China, call 120 immediately; do not wait for matching.

[MIT](LICENSE), Copyright (c) 2026 Yin Zichu, applies to the software, new accompanying documentation and blank CSV/JSON templates. Preserve its notice when reusing or distributing. The 10 reviewed original tools are separately licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), not MIT. Credit “Care in Farming Seasons · 殷子楚 Yin Zichu”, link to the license and indicate changes; do not imply endorsement by the original author. See the exact scope and inventory in [tool use and reuse](docs/tools-usage.en.md). [Third-party licenses](THIRD_PARTY_NOTICES.md) remain separate. Original research records, reports, articles and photographs are excluded. The [manifest](docs/source-manifest.json) hashes normalized UTF-8/LF text and raw binary tools separately. See [local acceptance and unverified items](docs/network-acceptance.md), [Security](SECURITY.md) and [Contributing](CONTRIBUTING.md).

## Copy this independent template

On [GitHub](https://github.com/YINZICHU/farm-support-network), choose **Use this template → Create a new repository**, or **Code → Download ZIP**. Follow this repository's setup, configuration and operations guides for your own instance. Copying the source does not grant access to the original project's accounts, data or servers, imply service delivery, or deploy anything automatically.
