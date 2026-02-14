# AI System Card — DocClassifier (DoD CUI Processing)

**System Name:** DocClassifier
**Deployment:** DoD agency, AWS GovCloud (US) IL5
**Authorization Basis:** FedRAMP High + DISA Cloud Computing SRG IL5 overlay

## System Purpose

DocClassifier is a transformer-based NLP system that automatically classifies unstructured documents containing Controlled Unclassified Information (CUI). The system processes incoming documents, identifies CUI markings and categories per NIST SP 800-171 and DoD CUI Registry, and routes documents to appropriate handling workflows based on classification confidence scores.

## AI/ML Characteristics

- **Model Architecture:** Fine-tuned transformer (encoder-only) trained on government document corpus
- **Training Data:** 250,000 labeled documents from participating DoD components, covering 42 CUI categories
- **Inference:** Real-time classification with confidence scoring (threshold: 0.85 for automated routing, below 0.85 requires human review)
- **Update Cycle:** Model retrained quarterly with new labeled data; updates go through change management board

## Data Types Processed

- Controlled Unclassified Information (CUI) — multiple categories including ITAR, FOUO, Privacy, Law Enforcement Sensitive
- Personally Identifiable Information (PII) — incidental to document content
- For Official Use Only (FOUO) legacy markings

## Risk Context

- **Misclassification risk:** Documents incorrectly classified as lower sensitivity could be routed to unauthorized personnel, resulting in CUI spillage
- **Availability:** Mission-critical for document intake workflow; downtime blocks document processing for 3 DoD components
- **Adversarial risk:** Potential for adversarial inputs designed to cause misclassification of sensitive documents

## Current Security Controls

- Access restricted to cleared personnel (Secret clearance minimum)
- All document processing occurs within IL5 boundary on AWS GovCloud
- Model weights and training data stored in FIPS 140-2 validated encrypted storage
- API access controlled via mutual TLS and DoD PKI certificates
- Audit logging of all classification decisions with document hash, confidence score, and assigned category

## Known Gaps

- No formal AI risk management framework implemented (NIST AI RMF adoption planned but not started)
- Bias testing limited to accuracy metrics across CUI categories; no demographic fairness analysis for PII-containing documents
- No adversarial robustness testing performed
- Model interpretability limited — no explanation provided for classification decisions
- No post-deployment monitoring for model drift or performance degradation
