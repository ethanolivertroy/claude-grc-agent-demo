// JSON Schema for OSCAL mapping-collection structured output. The agent's
// conversion response must conform to this schema, producing valid OSCAL
// mapping-collection JSON.
//
// Based on NIST OSCAL Control Mapping model (oscal-version 1.2.0). Required
// top-level sections: metadata, mappings. Each mapping entry describes a
// source-target resource pair with individual control maps and relationship types.
export const oscalMappingSchema = {
  type: "object",
  properties: {
    "mapping-collection": {
      type: "object",
      properties: {
        uuid: { type: "string" },
        metadata: {
          type: "object",
          properties: {
            title: { type: "string" },
            "last-modified": { type: "string" },
            version: { type: "string" },
            "oscal-version": { type: "string" },
            roles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                },
              },
            },
            parties: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  uuid: { type: "string" },
                  type: { type: "string" },
                  name: { type: "string" },
                },
              },
            },
          },
          required: ["title", "last-modified", "version", "oscal-version"],
        },
        mappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              uuid: { type: "string" },
              "source-resource": {
                type: "object",
                properties: {
                  type: { type: "string" },
                  href: { type: "string" },
                  title: { type: "string" },
                },
              },
              "target-resource": {
                type: "object",
                properties: {
                  type: { type: "string" },
                  href: { type: "string" },
                  title: { type: "string" },
                },
              },
              maps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    uuid: { type: "string" },
                    source: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        "id-ref": { type: "string" },
                      },
                    },
                    target: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        "id-ref": { type: "string" },
                      },
                    },
                    relationship: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        remarks: { type: "string" },
                      },
                    },
                  },
                  required: ["uuid", "source", "target", "relationship"],
                },
              },
            },
            required: ["uuid", "source-resource", "target-resource", "maps"],
          },
        },
      },
      required: ["uuid", "metadata", "mappings"],
    },
  },
  required: ["mapping-collection"],
} as const;
