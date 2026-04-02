---
name: openapi-from-chrome
description: Generate OpenAPI specifications from Chrome DevTools network requests. Use this skill when users need to reverse-engineer or document an undocumented API by analyzing network traffic, create API specifications from web application requests, or build efficient client interfaces for websites without public APIs.
---

# OpenAPI from Chrome DevTools

## Overview

This skill enables the generation of OpenAPI 3.0 specifications from network requests captured in Chrome DevTools. It's designed for scenarios where websites or web applications do not provide public API documentation, but API endpoints can be discovered through network traffic analysis. The skill uses the Chrome DevTools MCP server to capture network activity and generates properly structured OpenAPI specifications that can be used for API documentation, client generation, or building efficient programmatic interfaces.

## When to Use This Skill

Use this skill when:
- A website or web application lacks public API documentation
- Building an automated client for a web service that only has a web UI
- Reverse-engineering API endpoints for legitimate research or integration purposes
- Documenting internal APIs that were never formally specified
- Creating mock servers or API prototypes based on observed traffic
- Understanding the structure and behavior of third-party APIs

## Workflow

### Step 1: Capture Network Requests with Chrome DevTools MCP

Use the Chrome DevTools MCP to capture network traffic from the target website. The MCP provides tools to interact with Chrome DevTools remotely.

**Key MCP tools to use:**
- `mcp__chrome__navigate` - Navigate to the target URL
- `mcp__chrome__get_network_logs` - Retrieve captured network requests and responses

**Example workflow:**

1. Start by navigating to the target website:
```
Use mcp__chrome__navigate to go to the target URL
```

2. Interact with the website to trigger the API calls you want to document:
   - Click buttons
   - Submit forms
   - Navigate through pages
   - Perform user actions that trigger API requests

3. Retrieve the network logs:
```
Use mcp__chrome__get_network_logs to capture all network requests
```

**Important considerations:**
- Ensure the Chrome DevTools MCP server is properly configured and running
- The MCP must have network logging enabled to capture requests
- Perform meaningful user interactions to trigger relevant API endpoints
- Consider capturing requests from multiple user flows for comprehensive coverage

### Step 2: Filter and Prepare Network Data

The captured network logs will contain ALL requests, including static assets (CSS, JS, images). Filter the data to focus on API calls:

- Keep requests to API endpoints (typically JSON requests/responses)
- Remove static asset requests (.css, .js, .png, .jpg, etc.)
- Focus on requests that represent actual API operations
- Ensure requests contain meaningful method, URL, and response data

Save the filtered network requests to a JSON file. The expected format is an array of request objects, where each object should include:
```json
[
  {
    "url": "https://api.example.com/users/123",
    "method": "GET",
    "requestHeaders": {
      "content-type": "application/json"
    },
    "response": {
      "status": 200,
      "headers": {
        "content-type": "application/json"
      },
      "body": "{\"id\": 123, \"name\": \"John Doe\"}"
    }
  }
]
```

### Step 3: Generate OpenAPI Specification

Use the `generate_openapi.py` script to convert the network requests into an OpenAPI specification:

```bash
scripts/generate_openapi.py network_requests.json openapi_spec.yaml
```

**Script parameters:**
- First argument: Path to JSON file containing network requests (required)
- Second argument: Output file path for OpenAPI spec (optional, defaults to stdout)
  - Use `.yaml` or `.yml` extension for YAML output (requires PyYAML)
  - Use `.json` extension for JSON output
  - Omit for stdout (JSON format)

**What the script does:**
1. Parses each network request to extract endpoint information
2. Normalizes URL paths to identify path parameters (e.g., `/users/123` → `/users/{id}`)
3. Infers JSON schemas from request and response bodies
4. Extracts query parameters from URLs
5. Groups requests by path and HTTP method
6. Generates a complete OpenAPI 3.0 specification

**Schema inference:**
- The script automatically infers JSON schemas from request/response bodies
- Detects data types (string, integer, number, boolean, array, object)
- Identifies required fields (non-null values)
- Includes example values from actual requests
- Handles nested objects and arrays

**Path parameter detection:**
- Numeric path segments are converted to `{id}` parameters with integer type
- UUID-like strings are converted to `{id}` parameters with UUID format
- Custom heuristics can be extended in the script

### Step 4: Review and Refine the Specification

After generation, review the OpenAPI spec and make refinements:

1. **Verify endpoint paths**: Check that path parameters were correctly identified
2. **Add descriptions**: The generated spec includes basic summaries; enhance with detailed descriptions
3. **Refine schemas**:
   - Add constraints (minLength, maxLength, pattern, etc.)
   - Add enums for fields with known values
   - Clarify nullable fields
   - Add more detailed examples
4. **Add authentication**: Include security schemes if the API requires authentication
5. **Group operations**: Add tags to organize endpoints by resource or functionality
6. **Document error responses**: Add additional response codes (400, 401, 404, 500, etc.)

### Step 5: Validate and Use the Specification

Validate the generated OpenAPI spec:
- Use online validators like [Swagger Editor](https://editor.swagger.io/)
- Use CLI tools like `openapi-generator validate`
- Check that all schemas are valid and complete

**Use cases for the generated spec:**
- Generate API client libraries using `openapi-generator`
- Create mock servers for testing
- Generate API documentation with Swagger UI or Redoc
- Import into API development tools (Postman, Insomnia, etc.)
- Share with team members for integration work

## Script Reference

### generate_openapi.py

Located at: `scripts/generate_openapi.py`

**Purpose**: Convert Chrome DevTools network requests into OpenAPI 3.0 specification

**Usage**:
```bash
./scripts/generate_openapi.py <input.json> [output.yaml]
```

**Input format**: JSON array of network request objects with:
- `url`: Request URL
- `method`: HTTP method (GET, POST, PUT, DELETE, etc.)
- `requestHeaders`: Object containing request headers (optional)
- `postData`: Request body for POST/PUT requests (optional)
- `response`: Object containing:
  - `status`: HTTP status code
  - `headers`: Response headers
  - `body`: Response body (string)

**Output format**: OpenAPI 3.0 specification in JSON or YAML format

**Dependencies**:
- Python 3.6+
- `pyyaml` (optional, for YAML output): Install with `pip install pyyaml`

**Customization**: The script can be modified to:
- Adjust path parameter detection heuristics
- Customize schema inference rules
- Add additional metadata (tags, security, etc.)
- Filter or transform specific endpoints

## Tips and Best Practices

1. **Capture comprehensive flows**: Navigate through multiple user journeys to capture all relevant endpoints

2. **Authentication handling**: If the API requires authentication, ensure you're logged in when capturing requests. The generated spec may need manual addition of security schemes.

3. **Pagination and filtering**: Capture requests with different query parameters to document pagination, filtering, and sorting options

4. **Different HTTP methods**: Perform create, read, update, and delete operations to capture all CRUD endpoints

5. **Error cases**: Trigger error conditions (invalid input, unauthorized access, etc.) to capture error response schemas

6. **Multiple environments**: Consider capturing from different environments (dev, staging, production) to ensure consistency

7. **Privacy and security**:
   - Be mindful of sensitive data in captured requests (tokens, passwords, PII)
   - Sanitize the captured data before sharing specifications
   - Only reverse-engineer APIs for legitimate purposes with proper authorization

8. **Iterative refinement**: Generate an initial spec, identify gaps, capture additional requests, and regenerate to build comprehensive documentation

## Limitations

- **Path parameter detection**: The script uses heuristics to detect path parameters. Manual review may be needed for complex patterns.
- **Schema inference**: Schemas are inferred from observed data. Complete validation rules may need manual addition.
- **Static vs. dynamic**: The spec reflects the API as observed. Dynamic behavior or conditional fields may not be fully captured.
- **Websockets/SSE**: This skill focuses on HTTP request/response patterns. Real-time protocols require different approaches.

## Example Output

Generated OpenAPI specifications will include:

```yaml
openapi: 3.0.0
info:
  title: Generated API
  version: 1.0.0
  description: API specification generated from Chrome DevTools network requests
servers:
  - url: https://api.example.com
paths:
  /users/{id}:
    get:
      summary: GET /users/{id}
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: integer
                  name:
                    type: string
                  email:
                    type: string
                required:
                  - id
                  - name
```
