# Evaluation Strategy Index

Mục tiêu của bộ tài liệu này là giúp bạn lấy trọn điểm ở từng mục trong thang 10 điểm. Mỗi file tương ứng với một tiêu chí chấm, có đầy đủ:

- Thầy đang muốn thấy điều gì.
- Project này đã có bằng chứng nào.
- Nên demo theo thứ tự nào.
- Nên nói gì khi bảo vệ.
- Các lỗi dễ mất điểm cần tránh.

## Rubric Files

| Tiêu chí | Điểm | File hướng dẫn |
|---|---:|---|
| Core Technical Execution | 3.0 | `01_CORE_TECHNICAL_EXECUTION.md` |
| Algorithmic Logic & Anti-Clone | 2.5 | `02_ALGORITHMIC_LOGIC_ANTI_CLONE.md` |
| Security, Gas & Performance | 2.0 | `03_SECURITY_GAS_PERFORMANCE.md` |
| Technical Documentation | 1.5 | `04_TECHNICAL_DOCUMENTATION.md` |
| Teamwork & Presentation | 1.0 | `05_TEAMWORK_PRESENTATION.md` |

## Recommended Defense Order

1. Run `make check`.
2. Run `make demo`.
3. Open `make web` and show selective disclosure.
4. Explain the cryptography and Merkle proof design.
5. Show revocation and issuer authorization failure.
6. Mention tests, gas snapshot, threat model, and docs.

## One-Sentence Project Pitch

This project builds a decentralized academic credential system where a university signs a credential with secp256k1 ECC, the transcript is committed into a salted Merkle tree, and the holder can prove only selected claims while on-chain registries handle issuer authorization and revocation.
