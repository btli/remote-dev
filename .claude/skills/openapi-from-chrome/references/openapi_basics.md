# OpenAPI Specification Basics

This reference provides essential information about OpenAPI specifications for understanding and refining generated specs.

## OpenAPI Structure

A minimal OpenAPI 3.0 specification includes:

```yaml
openapi: 3.0.0
info:
  title: API Title
  version: 1.0.0
  description: API description
servers:
  - url: https://api.example.com
paths:
  /endpoint:
    get:
      summary: Endpoint summary
      responses:
        '200':
          description: Success response
```

## Key Components

### 1. Info Object

Basic API metadata:
```yaml
info:
  title: My API
  version: 1.0.0
  description: Detailed API description
  contact:
    name: API Support
    email: support@example.com
  license:
    name: Apache 2.0
    url: https://www.apache.org/licenses/LICENSE-2.0.html
```

### 2. Servers

API base URLs:
```yaml
servers:
  - url: https://api.example.com/v1
    description: Production server
  - url: https://staging-api.example.com/v1
    description: Staging server
```

### 3. Paths

API endpoints and operations:
```yaml
paths:
  /users/{userId}:
    get:
      summary: Get user by ID
      operationId: getUserById
      tags:
        - Users
      parameters:
        - name: userId
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: User found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '404':
          description: User not found
```

### 4. Parameters

Parameters can be in different locations:

**Path parameters** (part of URL path):
```yaml
parameters:
  - name: userId
    in: path
    required: true
    schema:
      type: integer
```

**Query parameters** (after `?` in URL):
```yaml
parameters:
  - name: limit
    in: query
    required: false
    schema:
      type: integer
      default: 10
  - name: offset
    in: query
    schema:
      type: integer
      default: 0
```

**Header parameters**:
```yaml
parameters:
  - name: X-API-Key
    in: header
    required: true
    schema:
      type: string
```

### 5. Request Body

For POST, PUT, PATCH requests:
```yaml
requestBody:
  description: User data
  required: true
  content:
    application/json:
      schema:
        type: object
        properties:
          name:
            type: string
          email:
            type: string
            format: email
        required:
          - name
          - email
```

### 6. Responses

Define possible responses:
```yaml
responses:
  '200':
    description: Success
    content:
      application/json:
        schema:
          type: object
          properties:
            id:
              type: integer
            name:
              type: string
  '400':
    description: Bad request
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/Error'
  '401':
    description: Unauthorized
  '404':
    description: Not found
  '500':
    description: Server error
```

### 7. Schemas

Define reusable data models:
```yaml
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: integer
          readOnly: true
        name:
          type: string
          minLength: 1
          maxLength: 100
        email:
          type: string
          format: email
        role:
          type: string
          enum:
            - admin
            - user
            - guest
        createdAt:
          type: string
          format: date-time
          readOnly: true
      required:
        - name
        - email

    Error:
      type: object
      properties:
        code:
          type: string
        message:
          type: string
      required:
        - code
        - message
```

### 8. Security

Define authentication schemes:
```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key

security:
  - bearerAuth: []
```

## Data Types

### Primitive Types

- `string`: Text values
  - Formats: `date`, `date-time`, `password`, `byte`, `binary`, `email`, `uuid`, `uri`, etc.
- `number`: Floating-point numbers
  - Formats: `float`, `double`
- `integer`: Whole numbers
  - Formats: `int32`, `int64`
- `boolean`: `true` or `false`
- `null`: Null value

### Complex Types

**Arrays**:
```yaml
type: array
items:
  type: string
minItems: 1
maxItems: 10
```

**Objects**:
```yaml
type: object
properties:
  name:
    type: string
  age:
    type: integer
required:
  - name
```

## Common Schema Constraints

- `minimum`, `maximum`: Numeric range
- `minLength`, `maxLength`: String length
- `pattern`: Regex pattern
- `enum`: List of allowed values
- `format`: Data format (email, uri, date, etc.)
- `readOnly`: Property only in responses
- `writeOnly`: Property only in requests
- `nullable`: Allow null values
- `default`: Default value
- `example`: Example value

## Tags

Organize operations into groups:
```yaml
tags:
  - name: Users
    description: User management operations
  - name: Posts
    description: Post management operations

paths:
  /users:
    get:
      tags:
        - Users
```

## Best Practices

1. **Use descriptive summaries**: Each operation should have a clear summary
2. **Document all responses**: Include common error codes (400, 401, 404, 500)
3. **Use schemas**: Define reusable schemas in `components/schemas`
4. **Add examples**: Include examples for requests and responses
5. **Validate specs**: Use tools like Swagger Editor to validate
6. **Version your API**: Include version in the URL or headers
7. **Document security**: Clearly specify authentication requirements
8. **Use tags**: Organize endpoints by resource or functionality

## Tools and Resources

- **Swagger Editor**: https://editor.swagger.io/ - Edit and validate specs
- **Swagger UI**: https://swagger.io/tools/swagger-ui/ - Generate interactive docs
- **Redoc**: https://redocly.com/redoc - Alternative documentation renderer
- **OpenAPI Generator**: https://openapi-generator.tech/ - Generate clients and servers
- **Spectral**: https://stoplight.io/open-source/spectral - Linting tool for OpenAPI

## References

- Official OpenAPI Specification: https://spec.openapis.org/oas/v3.0.3
- OpenAPI Guide: https://swagger.io/docs/specification/about/
