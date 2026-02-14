# Access Control Policy (AC-POL-001)

**Document Owner:** Chief Information Security Officer (CISO)
**Effective Date:** 2025-06-01
**Review Frequency:** Annual
**Last Reviewed:** 2026-01-15
**Classification:** For Official Use Only (FOUO)

## 1. Purpose

This policy establishes the requirements for managing access to CloudAI Platform information systems and data, ensuring that only authorized users have access to resources necessary to perform their duties.

## 2. Scope

This policy applies to all personnel (employees, contractors, and third parties) who access CloudAI Platform systems, including the production environment hosted on AWS GovCloud (US).

## 3. Account Types

The following account types are authorized on CloudAI Platform systems:

| Account Type | Description | Approval Authority | Max Duration |
|-------------|-------------|-------------------|-------------|
| Individual User | Standard named user account | Supervisor + ISSO | Indefinite (subject to review) |
| Privileged Administrator | Elevated access for system administration | Supervisor + ISSO + System Owner | Indefinite (subject to review) |
| Service Account | Non-interactive API and system integration accounts | ISSO + System Owner | Indefinite (subject to review) |
| Temporary | Time-bound access for specific projects or personnel | ISSO | 24 hours maximum |
| Emergency (Break-Glass) | Emergency access during incidents | SOC Manager (post-incident ISSO review) | 72 hours maximum |

## 4. Account Lifecycle

### 4.1 Account Creation
- All account creation requires a completed Access Request Form (ARF) submitted through the ticketing system
- Standard accounts require supervisor approval and ISSO approval
- Privileged accounts require additional System Owner approval
- Accounts are not provisioned until all required approvals are documented

### 4.2 Account Modification
- Role changes require a new ARF with appropriate approvals
- Lateral transfers require re-evaluation of access need-to-know
- All modifications are logged in the SIEM

### 4.3 Account Disablement
- Accounts are disabled within 24 hours of personnel separation
- Separation notifications are received via automated HR feed
- Inactive accounts are automatically disabled after 90 days (FedRAMP parameter)
- 14-day warning notification sent to account holder and account manager

### 4.4 Account Removal
- Disabled accounts are removed after 180 days unless retention is justified
- Removal is logged and auditable

## 5. Account Review

- ISSO conducts quarterly reviews of all active accounts
- Reviews verify: continued employment, need-to-know, appropriate access level, account manager accuracy
- Review results are documented and retained for 3 years
- Discrepancies are remediated within 5 business days

## 6. Privileged Access

- Privileged accounts use separate credentials from standard accounts
- Privileged sessions are logged and monitored in real-time
- Privileged account holders receive additional security training annually
- Emergency/break-glass account usage triggers automatic SOC notification

## 7. Session Management

- Interactive sessions are terminated after 15 minutes of inactivity (FedRAMP Moderate parameter)
- Concurrent session limits are enforced per account type
- Session tokens are invalidated server-side upon logout

## 8. Enforcement

Violations of this policy may result in disciplinary action, including revocation of access and termination of employment or contract.
