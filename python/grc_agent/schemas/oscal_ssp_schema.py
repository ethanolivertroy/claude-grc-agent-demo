# JSON Schema for OSCAL SSP structured output. The agent's conversion response
# must conform to this schema, producing valid OSCAL SSP JSON.
#
# Based on NIST OSCAL SSP model (oscal-version 1.2.0). Required top-level
# sections: metadata, import-profile, system-characteristics,
# system-implementation, control-implementation.
# The schema enforces structure while leaving room for optional OSCAL fields.
oscal_ssp_schema: dict = {
    "type": "object",
    "properties": {
        "system-security-plan": {
            "type": "object",
            "properties": {
                "uuid": {"type": "string"},
                "metadata": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "last-modified": {"type": "string"},
                        "version": {"type": "string"},
                        "oscal-version": {"type": "string"},
                        "roles": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "string"},
                                    "title": {"type": "string"},
                                },
                            },
                        },
                        "parties": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "uuid": {"type": "string"},
                                    "type": {"type": "string"},
                                    "name": {"type": "string"},
                                },
                            },
                        },
                    },
                    "required": ["title", "last-modified", "version", "oscal-version"],
                },
                "import-profile": {
                    "type": "object",
                    "properties": {
                        "href": {"type": "string"},
                    },
                    "required": ["href"],
                },
                "system-characteristics": {
                    "type": "object",
                    "properties": {
                        "system-ids": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "identifier-type": {"type": "string"},
                                    "id": {"type": "string"},
                                },
                            },
                        },
                        "system-name": {"type": "string"},
                        "description": {"type": "string"},
                        "security-sensitivity-level": {"type": "string"},
                        "system-information": {
                            "type": "object",
                            "properties": {
                                "information-types": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "title": {"type": "string"},
                                            "categorization": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "system": {"type": "string"},
                                                        "information-type-id": {"type": "string"},
                                                        "confidentiality-impact": {
                                                            "type": "object",
                                                            "properties": {"base": {"type": "string"}},
                                                        },
                                                        "integrity-impact": {
                                                            "type": "object",
                                                            "properties": {"base": {"type": "string"}},
                                                        },
                                                        "availability-impact": {
                                                            "type": "object",
                                                            "properties": {"base": {"type": "string"}},
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        "security-impact-level": {
                            "type": "object",
                            "properties": {
                                "security-objective-confidentiality": {"type": "string"},
                                "security-objective-integrity": {"type": "string"},
                                "security-objective-availability": {"type": "string"},
                            },
                        },
                        "status": {
                            "type": "object",
                            "properties": {
                                "state": {"type": "string"},
                            },
                            "required": ["state"],
                        },
                        "authorization-boundary": {
                            "type": "object",
                            "properties": {
                                "description": {"type": "string"},
                            },
                        },
                    },
                    "required": [
                        "system-ids",
                        "system-name",
                        "description",
                        "security-sensitivity-level",
                        "system-information",
                        "security-impact-level",
                        "status",
                        "authorization-boundary",
                    ],
                },
                "system-implementation": {
                    "type": "object",
                    "properties": {
                        "users": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "uuid": {"type": "string"},
                                    "role-ids": {"type": "array", "items": {"type": "string"}},
                                    "title": {"type": "string"},
                                },
                            },
                        },
                        "components": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "uuid": {"type": "string"},
                                    "type": {"type": "string"},
                                    "title": {"type": "string"},
                                    "description": {"type": "string"},
                                    "status": {
                                        "type": "object",
                                        "properties": {
                                            "state": {"type": "string"},
                                        },
                                    },
                                },
                                "required": ["uuid", "type", "title", "description", "status"],
                            },
                        },
                    },
                    "required": ["components"],
                },
                "control-implementation": {
                    "type": "object",
                    "properties": {
                        "description": {"type": "string"},
                        "implemented-requirements": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "uuid": {"type": "string"},
                                    "control-id": {"type": "string"},
                                    "statements": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "statement-id": {"type": "string"},
                                                "uuid": {"type": "string"},
                                                "by-components": {
                                                    "type": "array",
                                                    "items": {
                                                        "type": "object",
                                                        "properties": {
                                                            "component-uuid": {"type": "string"},
                                                            "description": {"type": "string"},
                                                            "implementation-status": {
                                                                "type": "object",
                                                                "properties": {
                                                                    "state": {"type": "string"},
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                                "required": ["uuid", "control-id"],
                            },
                        },
                    },
                    "required": ["description", "implemented-requirements"],
                },
            },
            "required": [
                "uuid",
                "metadata",
                "import-profile",
                "system-characteristics",
                "system-implementation",
                "control-implementation",
            ],
        },
    },
    "required": ["system-security-plan"],
}
