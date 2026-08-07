/**
 * Per-route invocation contracts published inside every x402 402 challenge as
 * `accepts[].outputSchema` — `input` tells an agent how to build the request
 * (method, path/query params, JSON body fields), `output` is the JSON Schema of
 * the successful response body. An agent that has never seen this API can
 * therefore call it correctly straight from the challenge it just received.
 *
 * Derived from `openapi.json`, so the runtime challenge (which the x402scan
 * discovery spec treats as authoritative) can never contradict the published
 * spec. Keys match the paywall route map exactly: `"<VERB> /path"`, with `*`
 * standing in for a path parameter.
 */

/** The `outputSchema` value carried by every accept entry of a paid route. */
export type RouteSchema = {
  /** How to invoke the route: HTTP method, parameters, request body fields. */
  input: Record<string, unknown>;
  /** JSON Schema of the 2xx response body. */
  output: Record<string, unknown>;
};

/** Keyed exactly like the paywall route map — spread into each route entry. */
export const ROUTE_SCHEMAS: Record<string, { outputSchema: RouteSchema }> = {
  "POST /restaurant/book": {
    outputSchema: {
      "input": {
        "type": "http",
        "method": "POST",
        "path": "/restaurant/book",
        "bodyType": "json",
        "bodyFields": {
          "date": {
            "type": "string",
            "format": "date"
          },
          "time": {
            "type": "string",
            "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$"
          },
          "party": {
            "type": "integer",
            "minimum": 1,
            "maximum": 8
          },
          "name": {
            "type": "string"
          },
          "notes": {
            "type": "string"
          }
        },
        "bodyFieldsRequired": [
          "date",
          "time",
          "party",
          "name"
        ]
      },
      "output": {
        "type": "object",
        "properties": {
          "reservationId": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "const": "confirmed"
          },
          "restaurant": {
            "type": "string"
          },
          "confirmedTime": {
            "type": "string"
          },
          "party": {
            "type": "integer"
          },
          "name": {
            "type": "string"
          },
          "table": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "type": {
                "type": "string"
              },
              "seats": {
                "type": "integer"
              }
            }
          },
          "refundTerms": {
            "type": "object",
            "description": "Same refund-terms shape the real merchant returns.",
            "properties": {
              "holdPrice": {
                "type": "string"
              },
              "freeCancellationHours": {
                "type": "integer"
              },
              "description": {
                "type": "string"
              }
            },
            "required": [
              "holdPrice",
              "freeCancellationHours",
              "description"
            ]
          },
          "cancelToken": {
            "type": "string"
          },
          "cancelEndpoint": {
            "type": "string"
          },
          "ledgerEntry": {
            "type": "object",
            "description": "Refund-ledger entry for the hold paid via x402.",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "hold",
                  "refund",
                  "forfeit"
                ]
              },
              "amount": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              },
              "at": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "kind",
              "amount",
              "reason",
              "at"
            ]
          },
          "ics": {
            "type": "string",
            "description": "base64 RFC 5545 calendar invite"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "sandbox": {
            "type": "object",
            "description": "Sandbox marker — present on every sandbox artifact, absent at the real merchants.",
            "properties": {
              "environment": {
                "type": "string",
                "const": "sandbox"
              },
              "merchant": {
                "type": "string"
              },
              "note": {
                "type": "string"
              }
            },
            "required": [
              "environment",
              "merchant",
              "note"
            ]
          },
          "signature": {
            "type": "string",
            "description": "hex HMAC-SHA256 over the canonical confirmation"
          }
        },
        "required": [
          "reservationId",
          "status",
          "confirmedTime",
          "party",
          "table",
          "refundTerms",
          "cancelToken",
          "ics",
          "signature"
        ]
      }
    },
  },
  "POST /hotel/book": {
    outputSchema: {
      "input": {
        "type": "http",
        "method": "POST",
        "path": "/hotel/book",
        "bodyType": "json",
        "bodyFields": {
          "checkIn": {
            "type": "string",
            "format": "date"
          },
          "checkOut": {
            "type": "string",
            "format": "date"
          },
          "guests": {
            "type": "integer",
            "minimum": 1,
            "maximum": 4
          },
          "name": {
            "type": "string"
          },
          "roomType": {
            "type": "string",
            "enum": [
              "STANDARD_KING",
              "STANDARD_TWIN",
              "DELUXE_KING",
              "SUITE"
            ]
          }
        },
        "bodyFieldsRequired": [
          "checkIn",
          "checkOut",
          "name"
        ]
      },
      "output": {
        "type": "object",
        "properties": {
          "bookingId": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "const": "confirmed"
          },
          "hotel": {
            "type": "string"
          },
          "hotelId": {
            "type": "string"
          },
          "stay": {
            "type": "object",
            "properties": {
              "checkIn": {
                "type": "string",
                "format": "date"
              },
              "checkOut": {
                "type": "string",
                "format": "date"
              },
              "nights": {
                "type": "integer"
              },
              "checkInTime": {
                "type": "string"
              },
              "checkOutTime": {
                "type": "string"
              }
            }
          },
          "guests": {
            "type": "integer"
          },
          "name": {
            "type": "string"
          },
          "room": {
            "type": "object",
            "properties": {
              "roomType": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "beds": {
                "type": "integer"
              },
              "maxOccupancy": {
                "type": "integer"
              }
            }
          },
          "price": {
            "type": "object",
            "properties": {
              "nightly": {
                "type": "string"
              },
              "total": {
                "type": "string"
              },
              "currency": {
                "type": "string"
              },
              "nights": {
                "type": "integer"
              }
            }
          },
          "refundTerms": {
            "type": "object",
            "description": "Same refund-terms shape the real merchant returns.",
            "properties": {
              "holdPrice": {
                "type": "string"
              },
              "freeCancellationHours": {
                "type": "integer"
              },
              "description": {
                "type": "string"
              }
            },
            "required": [
              "holdPrice",
              "freeCancellationHours",
              "description"
            ]
          },
          "cancelToken": {
            "type": "string"
          },
          "cancelEndpoint": {
            "type": "string"
          },
          "ledgerEntry": {
            "type": "object",
            "description": "Refund-ledger entry for the hold paid via x402.",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "hold",
                  "refund",
                  "forfeit"
                ]
              },
              "amount": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              },
              "at": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "kind",
              "amount",
              "reason",
              "at"
            ]
          },
          "ics": {
            "type": "string"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "sandbox": {
            "type": "object",
            "description": "Sandbox marker — present on every sandbox artifact, absent at the real merchants.",
            "properties": {
              "environment": {
                "type": "string",
                "const": "sandbox"
              },
              "merchant": {
                "type": "string"
              },
              "note": {
                "type": "string"
              }
            },
            "required": [
              "environment",
              "merchant",
              "note"
            ]
          },
          "signature": {
            "type": "string"
          }
        },
        "required": [
          "bookingId",
          "status",
          "stay",
          "room",
          "price",
          "cancelToken",
          "ics",
          "signature"
        ]
      }
    },
  },
  "POST /store/buy": {
    outputSchema: {
      "input": {
        "type": "http",
        "method": "POST",
        "path": "/store/buy",
        "bodyType": "json",
        "bodyFields": {
          "sku": {
            "type": "string",
            "enum": [
              "sandbox-guide",
              "sandbox-dataset",
              "sandbox-stickers",
              "sandbox-mug"
            ]
          },
          "name": {
            "type": "string"
          },
          "address": {
            "type": "string"
          },
          "country": {
            "type": "string"
          }
        },
        "bodyFieldsRequired": [
          "sku"
        ]
      },
      "output": {
        "type": "object",
        "properties": {
          "payload": {
            "type": "object",
            "properties": {
              "orderId": {
                "type": "string"
              },
              "sku": {
                "type": "string"
              },
              "kind": {
                "type": "string",
                "enum": [
                  "digital",
                  "physical"
                ]
              },
              "downloadUrl": {
                "type": "string",
                "description": "digital only — redeem free at GET /store/download/:token"
              },
              "downloadExpiresAt": {
                "type": "string",
                "format": "date-time"
              },
              "contentType": {
                "type": "string"
              },
              "contentSha256": {
                "type": "string"
              },
              "license": {
                "type": "string"
              },
              "fulfillment": {
                "type": "object",
                "description": "physical only",
                "properties": {
                  "status": {
                    "type": "string"
                  },
                  "promise": {
                    "type": "string"
                  },
                  "shipTo": {
                    "type": "object"
                  },
                  "weightGrams": {
                    "type": "integer"
                  }
                }
              },
              "supportEmail": {
                "type": "string"
              },
              "purchasedAt": {
                "type": "string",
                "format": "date-time"
              },
              "sandbox": {
                "type": "object",
                "description": "Sandbox marker — present on every sandbox artifact, absent at the real merchants.",
                "properties": {
                  "environment": {
                    "type": "string",
                    "const": "sandbox"
                  },
                  "merchant": {
                    "type": "string"
                  },
                  "note": {
                    "type": "string"
                  }
                },
                "required": [
                  "environment",
                  "merchant",
                  "note"
                ]
              }
            },
            "required": [
              "orderId",
              "sku",
              "kind",
              "purchasedAt"
            ]
          },
          "signature": {
            "type": "string"
          },
          "algorithm": {
            "type": "string",
            "const": "HMAC-SHA256"
          },
          "canonicalization": {
            "type": "string",
            "const": "sorted-keys-json"
          }
        },
        "required": [
          "payload",
          "signature",
          "algorithm",
          "canonicalization"
        ]
      }
    },
  },
};
