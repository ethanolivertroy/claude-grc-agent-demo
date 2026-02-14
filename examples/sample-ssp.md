# System Security Plan — CloudAI Platform (FedRAMP Moderate)

**System Name:** CloudAI Platform
**FIPS 199 Categorization:** Moderate (Confidentiality: Moderate, Integrity: Moderate, Availability: Low)
**Leveraged Authorization:** AWS GovCloud (US) — FedRAMP High P-ATO (JAB)

---

## AC-2 Account Management

**Implementation Status:** Implemented
**Control Origination:** Shared (Service Provider System Specific + Inherited from AWS GovCloud)
**Responsible Roles:** System Administrator, ISSO, HR Liaison

### Part (a) — Account Types
The CloudAI Platform defines and documents the following account types: individual user accounts (standard), privileged administrator accounts, service accounts for API integrations, and emergency/break-glass accounts. Account type definitions are maintained in the Access Control Policy (AC-POL-001) and reviewed annually.

### Part (b) — Account Managers
The ISSO designates account managers for each account group. System Administrators manage standard and service accounts. The Security Operations lead manages privileged and emergency accounts. Account manager assignments are documented in the Configuration Management Database (CMDB).

### Part (c) — Conditions for Group Membership
Group and role membership requires documented approval from the account manager and the user's supervisor. Role-based access control (RBAC) is enforced through the identity provider. Conditions for each role are defined in AC-POL-001 Appendix A.

### Part (d) — Authorized Users and Access
The system specifies authorized users, group and role membership, and access authorizations for each account type. Access authorizations are documented in the access control matrix and approved by the ISSO prior to provisioning.

### Part (e) — Approval Process
Account creation requires a completed access request form (ARF) approved by the user's supervisor and the ISSO. Privileged accounts require additional approval from the System Owner. Approvals are tracked in the ticketing system with audit trail.

### Part (f) — Account Lifecycle
Accounts are created, enabled, modified, disabled, and removed in accordance with the procedures in AC-POL-001. All lifecycle actions are logged in the SIEM. **Inherited from AWS GovCloud:** Physical and hypervisor-level account management for the underlying infrastructure is inherited from the AWS GovCloud FedRAMP High P-ATO.

### Part (g) — Account Monitoring
Account usage is monitored through SIEM integration. Atypical usage patterns trigger automated alerts to the SOC. Account activity reports are reviewed monthly by the ISSO.

### Part (h) — Account Manager Notification
Account managers are notified automatically via the ticketing system when accounts are no longer required (e.g., personnel transfer or termination), when users are terminated or transferred, and when system usage or need-to-know changes.

### Part (i) — Access Authorization
Access is authorized based on a valid access authorization, intended system usage documented in the ARF, and approval chain completion. All three conditions must be met before account provisioning.

### Part (j) — Account Review
Accounts are reviewed quarterly by the ISSO for compliance with account management requirements. Reviews verify continued need, appropriate access levels, and account manager accuracy. Review results are documented and retained for 3 years.

### Part (k) — Account Changes
Accounts are disabled within 24 hours of personnel separation (notification from HR via automated feed). Inactive accounts are disabled after 90 days per FedRAMP parameter assignment. Temporary and emergency accounts are disabled after 24 hours and 72 hours respectively.

---

## AC-2(1) Automated System Account Management

**Implementation Status:** Implemented
**Control Origination:** Service Provider System Specific
**Responsible Roles:** System Administrator, SOC Analyst

The organization employs automated mechanisms (identity provider + SIEM integration) to support the management of system accounts. Automated workflows handle account provisioning from approved ARFs, account disablement from the HR termination feed, and alert generation for anomalous account activity.

---

## AC-2(2) Automated Temporary and Emergency Account Management

**Implementation Status:** Implemented
**Control Origination:** Service Provider System Specific
**Responsible Roles:** System Administrator

The system automatically disables temporary accounts after 24 hours and emergency accounts after 72 hours. Automated expiration is enforced at the identity provider level with no manual override available without ISSO approval.

---

## AC-2(3) Disable Accounts

**Implementation Status:** Implemented
**Control Origination:** Service Provider System Specific
**Responsible Roles:** System Administrator, ISSO

The system automatically disables accounts that have been inactive for 90 days (FedRAMP assignment). A 14-day warning notification is sent to the account holder and account manager before disablement.

---

## AC-2(4) Automated Audit Actions

**Implementation Status:** Implemented
**Control Origination:** Service Provider System Specific
**Responsible Roles:** SOC Analyst, ISSO

The system automatically audits account creation, modification, enabling, disabling, and removal actions. All actions are forwarded to the SIEM within 5 minutes and retained for a minimum of 1 year online and 3 years in cold storage.

---

## AC-2(5) Inactivity Logout

**Implementation Status:** Implemented
**Control Origination:** Service Provider System Specific
**Responsible Roles:** System Administrator

Users are logged out after 15 minutes of inactivity (FedRAMP Moderate parameter). Session tokens are invalidated server-side upon logout.

---

## IR-4 Incident Handling

**Implementation Status:** Partially Implemented
**Control Origination:** Shared (Service Provider System Specific + Inherited from AWS GovCloud)
**Responsible Roles:** SOC Manager, Incident Commander, ISSO

### Part (a) — Incident Handling Capability
The organization implements an incident handling capability for incidents that is consistent with the incident response plan (IR-PL-001). The capability includes preparation, detection and analysis, containment, eradication, and recovery phases.

### Part (b) — Incident Handling Coordination
Incident handling activities are coordinated with contingency planning activities through integration of the IR and CP teams during tabletop exercises. **Gap:** Coordination with external organizations (US-CERT/CISA) is documented in the IRP but has not been exercised in the current assessment period.

### Part (c) — Incident Information
The organization incorporates lessons learned from ongoing incident handling activities into the incident response plan, training materials, and detection signatures. Lessons-learned reviews are conducted within 5 business days of incident closure. **Gap:** No formal incident tracking system is currently deployed — incidents are tracked via email and shared documents. A ticketing-based incident tracking system has been identified in the POA&M for implementation.

**Inherited from AWS GovCloud:** Physical security incident handling and infrastructure-level incident detection and response are inherited from the AWS GovCloud FedRAMP High P-ATO. AWS provides incident notifications per the shared responsibility model.
