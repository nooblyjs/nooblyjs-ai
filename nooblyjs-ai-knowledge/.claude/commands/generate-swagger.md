# Generate Swagger Documentation

Generate and maintain OpenAPI/Swagger documentation for all services in the noobly Core framework.

## What This Command Does

This command helps you:
1. Generate OpenAPI/Swagger specs for each service
2. Document all API endpoints with proper structure
3. Include request/response schemas
4. Add security requirements and authentication
5. Document error responses
6. Maintain consistency across all services
7. Generate interactive API documentation
8. Export specs for API gateways/tools

## Prerequisites

Each service should have:
- `src/{serviceName}/routes/swagger/docs.json` - OpenAPI spec file
- Documented routes in `src/{serviceName}/routes/index.js`
- Request/response models defined

## OpenAPI/Swagger File Structure

Each service gets an `src/{serviceName}/routes/swagger/docs.json`:

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "Service Name API",
    "description": "Service description",
    "version": "1.0.0",
    "contact": {
      "name": "noobly Team",
      "email": "tech@example.com"
    },
    "license": {
      "name": "ISC"
    }
  },
  "servers": [
    {
      "url": "http://localhost:3001",
      "description": "Development server"
    },
    {
      "url": "https://api.example.com",
      "description": "Production server"
    }
  ],
  "components": {
    "securitySchemes": {
      "ApiKeyAuth": {
        "type": "apiKey",
        "in": "header",
        "name": "Authorization",
        "description": "API Key for authentication"
      },
      "BearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "JWT Bearer token"
      }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "properties": {
          "error": { "type": "string" },
          "message": { "type": "string" },
          "code": { "type": "string" }
        }
      }
    }
  },
  "paths": {
    "/services/servicename/api/endpoint": {
      "get": {
        "summary": "Get endpoint summary",
        "description": "Detailed description",
        "tags": ["Service Name"],
        "security": [{ "ApiKeyAuth": [] }],
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success response",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Model" }
              }
            }
          },
          "401": { "description": "Unauthorized" },
          "500": { "description": "Server error" }
        }
      }
    }
  }
}
```

## Services and Their API Endpoints

### 1. Logging Service
**Location:** `src/logging/routes/swagger/docs.json`

**Base Path:** `/services/logging/api/`

**Endpoints:**
```
GET    /logs              - Get all logs
POST   /logs              - Create log entry
GET    /logs/:id          - Get specific log
DELETE /logs/:id          - Delete log
GET    /analytics         - Get log analytics
GET    /levels/:level     - Get logs by level
```

**Swagger Template:**
```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "Logging Service API",
    "description": "Centralized logging service with file, memory, and API providers",
    "version": "1.0.0"
  },
  "servers": [
    { "url": "http://localhost:3001", "description": "Development" }
  ],
  "paths": {
    "/services/logging/api/logs": {
      "get": {
        "summary": "Get all logs",
        "description": "Retrieve all logged messages with optional filtering",
        "tags": ["Logs"],
        "parameters": [
          {
            "name": "level",
            "in": "query",
            "schema": { "enum": ["debug", "info", "warn", "error"] },
            "description": "Filter by log level"
          },
          {
            "name": "limit",
            "in": "query",
            "schema": { "type": "integer", "default": 100 }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": { "type": "integer", "default": 0 }
          }
        ],
        "responses": {
          "200": {
            "description": "List of logs",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": { "type": "string" },
                      "level": { "type": "string" },
                      "message": { "type": "string" },
                      "metadata": { "type": "object" },
                      "timestamp": { "type": "string", "format": "date-time" }
                    }
                  }
                }
              }
            }
          },
          "401": { "description": "Unauthorized" },
          "500": { "description": "Server error" }
        }
      },
      "post": {
        "summary": "Create log entry",
        "tags": ["Logs"],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "level": { "enum": ["debug", "info", "warn", "error"] },
                  "message": { "type": "string" },
                  "metadata": { "type": "object" }
                },
                "required": ["level", "message"]
              }
            }
          }
        },
        "responses": {
          "201": { "description": "Log created" },
          "400": { "description": "Invalid input" },
          "401": { "description": "Unauthorized" }
        }
      }
    },
    "/services/logging/api/analytics": {
      "get": {
        "summary": "Get logging analytics",
        "tags": ["Analytics"],
        "responses": {
          "200": {
            "description": "Analytics data",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "totalLogs": { "type": "integer" },
                    "debugCount": { "type": "integer" },
                    "infoCount": { "type": "integer" },
                    "warnCount": { "type": "integer" },
                    "errorCount": { "type": "integer" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### 2. Caching Service
**Location:** `src/caching/routes/swagger/docs.json`

**Base Path:** `/services/caching/api/`

**Endpoints:**
```
GET    /get/:key         - Get cached value
POST   /set              - Set cached value
DELETE /delete/:key      - Delete cache entry
GET    /has/:key         - Check if key exists
POST   /clear            - Clear all cache
GET    /analytics        - Get cache statistics
```

**Key Request/Response Schemas:**
```json
{
  "GetCache": {
    "type": "object",
    "properties": {
      "key": { "type": "string" },
      "value": { "type": "object" }
    }
  },
  "SetCache": {
    "type": "object",
    "properties": {
      "key": { "type": "string" },
      "value": { "type": "object" },
      "ttl": { "type": "integer", "description": "Time to live in seconds" }
    }
  },
  "CacheAnalytics": {
    "type": "object",
    "properties": {
      "size": { "type": "integer" },
      "hitCount": { "type": "integer" },
      "missCount": { "type": "integer" },
      "hitRate": { "type": "number" }
    }
  }
}
```

### 3. Data Service
**Location:** `src/dataservice/routes/swagger/docs.json`

**Base Path:** `/services/dataservice/api/`

**Endpoints:**
```
GET    /:collection             - List all items
POST   /:collection             - Create item
GET    /:collection/:id         - Get item
PUT    /:collection/:id         - Update item
DELETE /:collection/:id         - Delete item
POST   /:collection/query       - Query items
```

**Schema Template:**
```json
{
  "ListItems": {
    "type": "object",
    "properties": {
      "items": { "type": "array" },
      "count": { "type": "integer" },
      "total": { "type": "integer" }
    }
  },
  "Item": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "data": { "type": "object" },
      "createdAt": { "type": "string", "format": "date-time" },
      "updatedAt": { "type": "string", "format": "date-time" }
    }
  }
}
```

### 4. Queueing Service
**Location:** `src/queueing/routes/swagger/docs.json`

**Base Path:** `/services/queueing/api/`

**Endpoints:**
```
POST   /enqueue          - Enqueue job
GET    /job/:id          - Get job status
POST   /job/:id/retry    - Retry job
DELETE /job/:id          - Delete job
GET    /queue/:name      - Get queue info
POST   /process/:name    - Register processor
```

**Schemas:**
```json
{
  "Job": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "name": { "type": "string" },
      "status": { "enum": ["pending", "processing", "completed", "failed"] },
      "data": { "type": "object" },
      "attempts": { "type": "integer" },
      "error": { "type": "string" }
    }
  },
  "EnqueueRequest": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "data": { "type": "object" },
      "priority": { "type": "integer" },
      "retries": { "type": "integer" }
    },
    "required": ["name", "data"]
  }
}
```

### 5. Workflow Service
**Location:** `src/workflow/routes/swagger/docs.json`

**Base Path:** `/services/workflow/api/`

**Endpoints:**
```
POST   /execute          - Execute workflow
GET    /execution/:id    - Get execution status
POST   /execution/:id/pause   - Pause execution
POST   /execution/:id/resume  - Resume execution
GET    /history          - Get execution history
```

### 6. Filing Service
**Location:** `src/filing/routes/swagger/docs.json`

**Base Path:** `/services/filing/api/`

**Endpoints:**
```
POST   /upload           - Upload file
GET    /download/:path   - Download file
DELETE /delete/:path     - Delete file
GET    /list/:path       - List files
GET    /exists/:path     - Check if file exists
```

### 7. Scheduling Service
**Location:** `src/scheduling/routes/swagger/docs.json`

**Base Path:** `/services/scheduling/api/`

**Endpoints:**
```
POST   /schedule         - Schedule task
GET    /scheduled        - List scheduled tasks
DELETE /scheduled/:id    - Cancel task
POST   /execute/:id      - Execute scheduled task
```

### 8. Searching Service
**Location:** `src/searching/routes/swagger/docs.json`

**Base Path:** `/services/searching/api/`

**Endpoints:**
```
POST   /index            - Index document
GET    /search           - Search documents
DELETE /clear-index      - Clear index
GET    /stats            - Get search stats
```

### 9. Auth Service
**Location:** `src/authservice/routes/swagger/docs.json`

**Base Path:** `/services/authservice/api/`

**Endpoints:**
```
POST   /register         - Register user
POST   /login            - Login user
POST   /logout           - Logout user
GET    /verify-token     - Verify token
GET    /profile          - Get user profile
PUT    /profile          - Update profile
POST   /change-password  - Change password
```

**Security:** BearerAuth (JWT)

### 10. AI Service
**Location:** `src/aiservice/routes/swagger/docs.json`

**Base Path:** `/services/aiservice/api/`

**Endpoints:**
```
POST   /prompt           - Send prompt to AI
POST   /completion       - Get text completion
POST   /chat             - Chat with AI
GET    /models           - List available models
POST   /config           - Configure AI settings
```

### 11. Notifying Service
**Location:** `src/notifying/routes/swagger/docs.json`

**Base Path:** `/services/notifying/api/`

**Endpoints:**
```
POST   /notify           - Send notification
GET    /notifications    - Get notifications
DELETE /notifications/:id - Delete notification
GET    /status/:id       - Get notification status
```

### 12. Measuring Service
**Location:** `src/measuring/routes/swagger/docs.json`

**Base Path:** `/services/measuring/api/`

**Endpoints:**
```
POST   /metric           - Record metric
GET    /metrics          - Get all metrics
GET    /metrics/:name    - Get specific metric
DELETE /metrics/:name    - Delete metric
GET    /analytics        - Get analytics
```

### 13. Fetching Service
**Location:** `src/fetching/routes/swagger/docs.json`

**Base Path:** `/services/fetching/api/`

**Endpoints:**
```
POST   /fetch            - Make HTTP request
GET    /cache/:url       - Get cached response
DELETE /cache/:url       - Clear cached response
GET    /status           - Get service status
```

### 14. App Service
**Location:** `src/appservice/routes/swagger/docs.json`

**Base Path:** `/services/appservice/api/`

**Endpoints:**
```
GET    /health           - Health check
GET    /status           - Service status
GET    /config           - Get configuration
POST   /config           - Update configuration
```

## Common Swagger Patterns

### Authentication Security Scheme
```json
"components": {
  "securitySchemes": {
    "ApiKeyAuth": {
      "type": "apiKey",
      "in": "header",
      "name": "Authorization",
      "description": "API Key as Bearer token"
    },
    "BearerAuth": {
      "type": "http",
      "scheme": "bearer",
      "bearerFormat": "JWT",
      "description": "JWT Bearer token from login"
    }
  }
}
```

### Apply to Specific Endpoints
```json
"get": {
  "security": [
    { "ApiKeyAuth": [] },
    { "BearerAuth": [] }
  ]
}
```

### Standard Error Responses
```json
"responses": {
  "400": {
    "description": "Bad Request",
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "properties": {
            "error": { "type": "string" },
            "details": { "type": "string" }
          }
        }
      }
    }
  },
  "401": {
    "description": "Unauthorized",
    "content": {
      "application/json": {
        "schema": { "$ref": "#/components/schemas/UnauthorizedError" }
      }
    }
  },
  "404": {
    "description": "Not Found",
    "content": {
      "application/json": {
        "schema": { "$ref": "#/components/schemas/NotFoundError" }
      }
    }
  },
  "500": {
    "description": "Internal Server Error",
    "content": {
      "application/json": {
        "schema": { "$ref": "#/components/schemas/ServerError" }
      }
    }
  }
}
```

### Request Body with Content Types
```json
"requestBody": {
  "required": true,
  "content": {
    "application/json": {
      "schema": {
        "type": "object",
        "properties": {
          "key": { "type": "string" },
          "value": { "type": "object" }
        },
        "required": ["key"]
      }
    }
  }
}
```

### Parameters (Query, Path, Header)
```json
"parameters": [
  {
    "name": "id",
    "in": "path",
    "required": true,
    "schema": { "type": "string" },
    "description": "Item ID"
  },
  {
    "name": "limit",
    "in": "query",
    "schema": { "type": "integer", "default": 10 },
    "description": "Max results"
  },
  {
    "name": "X-API-Key",
    "in": "header",
    "schema": { "type": "string" },
    "description": "API Key"
  }
]
```

## Generation Checklist

For each service, ensure the swagger file includes:

- [ ] **OpenAPI 3.0.0 format**
- [ ] **Service info section** with title, description, version
- [ ] **Servers section** with development and production URLs
- [ ] **Security schemes** (API Key, Bearer Auth, etc.)
- [ ] **All endpoints** from routes/index.js
- [ ] **Request parameters** (path, query, header)
- [ ] **Request body** schemas with examples
- [ ] **Response schemas** for success and error cases
- [ ] **HTTP status codes** (200, 201, 400, 401, 404, 500)
- [ ] **Security requirements** on protected endpoints
- [ ] **Tags** for grouping related endpoints
- [ ] **Descriptions** for all operations
- [ ] **Examples** where helpful
- [ ] **Reusable schemas** in components section

## Services That Already Have Swagger Files

Check these locations first - some may already have partial documentation:
```
- src/caching/routes/swagger/docs.json (exists)
- src/logging/routes/swagger/docs.json (exists)
- src/notifying/routes/swagger/docs.json (exists)
- src/queueing/routes/swagger/docs.json (exists)
```

## Services Needing Swagger Documentation

Create or complete these files:
```
- src/dataservice/routes/swagger/docs.json
- src/filing/routes/swagger/docs.json
- src/aiservice/routes/swagger/docs.json
- src/authservice/routes/swagger/docs.json
- src/workflow/routes/swagger/docs.json
- src/scheduling/routes/swagger/docs.json
- src/searching/routes/swagger/docs.json
- src/measuring/routes/swagger/docs.json
- src/fetching/routes/swagger/docs.json
- src/appservice/routes/swagger/docs.json
- src/notifying/routes/swagger/docs.json (review/update)
```

## How to Generate Swagger Files

### Manual Approach
1. Review `src/{serviceName}/routes/index.js`
2. Document each route with endpoint, method, parameters
3. Create schemas for request/response bodies
4. Create `src/{serviceName}/routes/swagger/docs.json`
5. Test with Swagger UI

### Using Swagger/OpenAPI Tools
```bash
# Install swagger-ui-express (if not already installed)
npm install swagger-ui-express

# Generate from JSDoc comments (if implemented)
# Use tools like swagger-jsdoc to auto-generate from comments
```

### Testing Swagger Files

```javascript
// Test in Express route
const swaggerDocs = require('./src/{serviceName}/routes/swagger/docs.json');

app.get('/services/{serviceName}/api/docs', (req, res) => {
  res.json(swaggerDocs);
});
```

## Swagger File Organization

```
src/{serviceName}/routes/
├── index.js
├── swagger/
│   └── docs.json
```

## Template for New Service Swagger

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "[Service Name] API",
    "description": "[Service description]",
    "version": "1.0.0",
    "contact": {
      "name": "noobly Team"
    },
    "license": {
      "name": "ISC"
    }
  },
  "servers": [
    {
      "url": "http://localhost:3001",
      "description": "Development server"
    },
    {
      "url": "https://api.example.com",
      "description": "Production server"
    }
  ],
  "components": {
    "securitySchemes": {
      "ApiKeyAuth": {
        "type": "apiKey",
        "in": "header",
        "name": "Authorization"
      }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "properties": {
          "error": { "type": "string" },
          "message": { "type": "string" }
        }
      }
    }
  },
  "paths": {
    "/services/[servicename]/api/[endpoint]": {
      "get": {
        "summary": "[Summary]",
        "description": "[Description]",
        "tags": ["[Service Name]"],
        "security": [{ "ApiKeyAuth": [] }],
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": { "type": "object" }
              }
            }
          },
          "400": { "description": "Bad Request" },
          "401": { "description": "Unauthorized" },
          "500": { "description": "Server Error" }
        }
      }
    }
  }
}
```

## Documentation Links

- [OpenAPI 3.0.0 Specification](https://spec.openapis.org/oas/v3.0.0)
- [Swagger Editor](https://editor.swagger.io/)
- [JSON Schema Reference](https://json-schema.org/)

## Validation

Validate generated Swagger files:

```bash
# Use online validator
# Visit https://editor.swagger.io/ and paste JSON

# Or use command line tools
npm install -g swagger-cli
swagger-cli validate src/{serviceName}/routes/swagger/docs.json
```

## Integration with Route Handler

Mount Swagger docs in routes:

```javascript
// In src/{serviceName}/routes/index.js
const swaggerDocs = require('./swagger/docs.json');

module.exports = (options, eventEmitter, service) => {
  const router = require('express').Router();

  // Swagger docs endpoint
  router.get('/docs', (req, res) => {
    res.json(swaggerDocs);
  });

  // Other routes...
  router.get('/endpoint', (req, res) => {
    // implementation
  });

  return router;
};
```

## Checklist for Completion

- [ ] All 14 services have swagger/docs.json
- [ ] All endpoints documented
- [ ] All request/response schemas defined
- [ ] Security schemes configured
- [ ] Error responses documented
- [ ] Examples provided for complex endpoints
- [ ] Reusable schemas in components
- [ ] All files validated
- [ ] Mounted in route handlers
- [ ] Documentation links working

## Last Updated

Last Generated: [DATE]
Services Documented: [COUNT/14]
Coverage: [PERCENTAGE]%

## Related Commands

- `/help` - Get help with Claude Code
- `/update-docs` - Update general documentation
- `/security-audit` - Security audit command

## Notes

- Keep Swagger specs in sync with actual routes
- Update when adding new endpoints
- Include examples for complex operations
- Review quarterly for accuracy
- Use consistent naming conventions
