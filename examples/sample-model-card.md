# Model Card — DocClassifier v2.1

## Model Overview

| Field | Value |
|-------|-------|
| Model Name | DocClassifier v2.1 |
| Model Type | Encoder-only Transformer (fine-tuned) |
| Base Model | DeBERTa-v3-large |
| Task | Multi-label document classification |
| Training Date | 2025-11-15 |
| Version | 2.1.0 |
| Owner | AI Engineering Team |

## Intended Use

DocClassifier identifies and categorizes Controlled Unclassified Information (CUI) within unstructured government documents. It assigns CUI category labels per the DoD CUI Registry and routes documents to appropriate handling workflows based on classification confidence.

**Primary users:** DoD document management personnel, records managers, classification reviewers.

**Out-of-scope uses:** This model is not designed for classifying information at the SECRET level or above. It is not intended for real-time streaming classification or use outside the DoD CUI domain.

## Training Data

- **Source:** 250,000 labeled documents from 3 participating DoD components
- **Categories:** 42 CUI categories including ITAR, FOUO, Privacy, Law Enforcement Sensitive, Critical Infrastructure, Export Controlled
- **Labeling:** Human-labeled by trained classification reviewers with inter-annotator agreement of 0.89 (Cohen's kappa)
- **Splits:** 70% training, 15% validation, 15% test (stratified by category)
- **Data retention:** Training data stored in FIPS 140-2 validated encrypted storage within the IL5 boundary

## Performance Metrics

| Metric | Overall | High-Frequency Categories | Low-Frequency Categories |
|--------|---------|--------------------------|-------------------------|
| Precision | 0.94 | 0.96 | 0.87 |
| Recall | 0.91 | 0.93 | 0.82 |
| F1 Score | 0.92 | 0.94 | 0.84 |
| False Positive Rate | 0.03 | 0.02 | 0.06 |

**Confidence threshold:** Documents with classification confidence below 0.85 are routed to human review rather than automated processing. Approximately 12% of documents fall below this threshold.

## Limitations

- **Low-frequency categories:** Performance degrades for CUI categories with fewer than 500 training examples (8 of 42 categories)
- **Multi-label documents:** Documents requiring multiple CUI category labels have lower accuracy (F1: 0.86) than single-label documents (F1: 0.95)
- **Document length:** Performance may degrade on documents exceeding 50 pages due to chunking and aggregation heuristics
- **Temporal drift:** Model performance has not been evaluated against documents created after the training cutoff. Quarterly retraining mitigates this but does not eliminate the risk

## Ethical Considerations

- **Misclassification impact:** Under-classification (failing to identify CUI) could result in CUI spillage to unauthorized systems or personnel. Over-classification causes unnecessary handling restrictions and operational friction.
- **Bias:** The model was trained on documents from 3 DoD components. Performance on documents from other components or agencies has not been validated.
- **Fairness:** No demographic fairness analysis has been performed. PII-containing documents (e.g., personnel records) may be affected by demographic biases in the training data.

## AI Risk Assessment

- **EU AI Act classification:** Not directly applicable (DoD system), but system characteristics would likely be classified as **high-risk** under Annex III due to critical infrastructure deployment
- **NIST AI RMF alignment:** GOVERN and MAP functions partially addressed through this model card and the system card. MEASURE and MANAGE functions are not formally implemented.

## Update History

| Version | Date | Changes |
|---------|------|---------|
| 2.1.0 | 2025-11-15 | Quarterly retraining with 15,000 new labeled documents; added 2 new CUI categories |
| 2.0.0 | 2025-08-01 | Base model upgrade from DeBERTa-v2 to v3; improved low-frequency category handling |
| 1.0.0 | 2025-03-01 | Initial deployment |
