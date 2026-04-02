#!/usr/bin/env python3
"""
Generate OpenAPI specification from Chrome DevTools network requests.

This script analyzes network requests captured from Chrome DevTools and generates
a valid OpenAPI 3.0 specification documenting the API endpoints discovered.
"""

import json
import sys
from collections import defaultdict
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, parse_qs


def infer_schema_from_value(value: Any, example: bool = True) -> Dict[str, Any]:
    """Infer JSON schema from a value."""
    if value is None:
        return {"type": "null", "example": None} if example else {"type": "null"}

    if isinstance(value, bool):
        schema = {"type": "boolean"}
        if example:
            schema["example"] = value
        return schema

    if isinstance(value, int):
        schema = {"type": "integer"}
        if example:
            schema["example"] = value
        return schema

    if isinstance(value, float):
        schema = {"type": "number"}
        if example:
            schema["example"] = value
        return schema

    if isinstance(value, str):
        schema = {"type": "string"}
        if example:
            schema["example"] = value
        return schema

    if isinstance(value, list):
        if not value:
            return {"type": "array", "items": {}}

        # Use first item as schema template
        item_schema = infer_schema_from_value(value[0], example=example)
        schema = {"type": "array", "items": item_schema}
        if example:
            schema["example"] = value
        return schema

    if isinstance(value, dict):
        properties = {}
        required = []

        for key, val in value.items():
            properties[key] = infer_schema_from_value(val, example=example)
            if val is not None:
                required.append(key)

        schema = {
            "type": "object",
            "properties": properties
        }
        if required:
            schema["required"] = required
        if example:
            schema["example"] = value

        return schema

    return {"type": "string"}


def normalize_path(url: str) -> tuple[str, str, dict]:
    """
    Normalize URL path by identifying path parameters.
    Returns: (base_url, normalized_path, path_params)
    """
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"
    path = parsed.path

    # Simple heuristic: if a path segment is numeric or UUID-like, treat as parameter
    path_parts = path.split('/')
    normalized_parts = []
    path_params = {}

    for part in path_parts:
        if not part:
            normalized_parts.append(part)
            continue

        # Check if it's a number
        if part.isdigit():
            param_name = "id"
            normalized_parts.append(f"{{{param_name}}}")
            path_params[param_name] = {
                "name": param_name,
                "in": "path",
                "required": True,
                "schema": {"type": "integer"},
                "example": int(part)
            }
        # Check if it's a UUID-like string (simple heuristic)
        elif len(part) > 20 and ('-' in part or len(part) == 32):
            param_name = "id"
            normalized_parts.append(f"{{{param_name}}}")
            path_params[param_name] = {
                "name": param_name,
                "in": "path",
                "required": True,
                "schema": {"type": "string", "format": "uuid"},
                "example": part
            }
        else:
            normalized_parts.append(part)

    normalized_path = '/'.join(normalized_parts)
    return base_url, normalized_path, path_params


def parse_network_request(request: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Parse a single network request into OpenAPI components."""
    try:
        url = request.get("url", "")
        method = request.get("method", "GET").lower()

        # Skip non-API requests (static assets, etc.)
        if any(ext in url for ext in ['.css', '.js', '.png', '.jpg', '.gif', '.svg', '.woff', '.ttf']):
            return None

        base_url, path, path_params = normalize_path(url)

        # Parse query parameters
        parsed_url = urlparse(url)
        query_params = parse_qs(parsed_url.query)
        query_param_specs = []

        for param_name, values in query_params.items():
            query_param_specs.append({
                "name": param_name,
                "in": "query",
                "schema": {"type": "string"},
                "example": values[0] if values else ""
            })

        # Parse request body
        request_body = None
        request_headers = request.get("requestHeaders", {})
        content_type = request_headers.get("content-type", "")

        if request.get("postData"):
            post_data = request["postData"]
            if "application/json" in content_type:
                try:
                    body_json = json.loads(post_data)
                    request_body = {
                        "content": {
                            "application/json": {
                                "schema": infer_schema_from_value(body_json, example=False)
                            }
                        }
                    }
                except json.JSONDecodeError:
                    pass

        # Parse response
        response_spec = None
        response = request.get("response", {})
        response_status = response.get("status", 200)
        response_body = response.get("body")

        if response_body:
            response_content_type = response.get("headers", {}).get("content-type", "")

            if "application/json" in response_content_type:
                try:
                    response_json = json.loads(response_body)
                    response_spec = {
                        str(response_status): {
                            "description": f"Successful response",
                            "content": {
                                "application/json": {
                                    "schema": infer_schema_from_value(response_json, example=False)
                                }
                            }
                        }
                    }
                except json.JSONDecodeError:
                    pass

        if not response_spec:
            response_spec = {
                "200": {"description": "Successful response"}
            }

        return {
            "base_url": base_url,
            "path": path,
            "method": method,
            "path_params": list(path_params.values()),
            "query_params": query_param_specs,
            "request_body": request_body,
            "responses": response_spec
        }

    except Exception as e:
        print(f"Error parsing request: {e}", file=sys.stderr)
        return None


def generate_openapi_spec(requests: List[Dict[str, Any]], title: str = "Generated API", version: str = "1.0.0") -> Dict[str, Any]:
    """Generate OpenAPI 3.0 specification from network requests."""

    # Group requests by path and method
    paths = defaultdict(lambda: defaultdict(dict))
    servers = set()

    for request in requests:
        parsed = parse_network_request(request)
        if not parsed:
            continue

        servers.add(parsed["base_url"])
        path = parsed["path"]
        method = parsed["method"]

        # Build operation object
        operation = {
            "summary": f"{method.upper()} {path}",
            "responses": parsed["responses"]
        }

        # Add parameters
        parameters = []
        if parsed["path_params"]:
            parameters.extend(parsed["path_params"])
        if parsed["query_params"]:
            parameters.extend(parsed["query_params"])

        if parameters:
            operation["parameters"] = parameters

        # Add request body
        if parsed["request_body"]:
            operation["requestBody"] = parsed["request_body"]

        # Merge with existing operation if present
        if method in paths[path]:
            # Merge parameters
            existing_params = {p["name"]: p for p in paths[path][method].get("parameters", [])}
            for param in parameters:
                if param["name"] not in existing_params:
                    existing_params[param["name"]] = param

            if existing_params:
                paths[path][method]["parameters"] = list(existing_params.values())
        else:
            paths[path][method] = operation

    # Build OpenAPI spec
    spec = {
        "openapi": "3.0.0",
        "info": {
            "title": title,
            "version": version,
            "description": "API specification generated from Chrome DevTools network requests"
        },
        "servers": [{"url": server} for server in sorted(servers)],
        "paths": {path: dict(methods) for path, methods in sorted(paths.items())}
    }

    return spec


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: generate_openapi.py <network_requests.json> [output.yaml]", file=sys.stderr)
        print("\nInput JSON should be an array of network request objects.", file=sys.stderr)
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    # Read network requests
    with open(input_file, 'r') as f:
        requests = json.load(f)

    if not isinstance(requests, list):
        print("Error: Input must be a JSON array of requests", file=sys.stderr)
        sys.exit(1)

    # Generate OpenAPI spec
    spec = generate_openapi_spec(requests)

    # Output
    if output_file:
        if output_file.endswith('.yaml') or output_file.endswith('.yml'):
            try:
                import yaml
                with open(output_file, 'w') as f:
                    yaml.dump(spec, f, default_flow_style=False, sort_keys=False)
                print(f"OpenAPI spec written to {output_file}")
            except ImportError:
                print("Warning: PyYAML not installed, outputting JSON instead", file=sys.stderr)
                with open(output_file.replace('.yaml', '.json').replace('.yml', '.json'), 'w') as f:
                    json.dump(spec, f, indent=2)
        else:
            with open(output_file, 'w') as f:
                json.dump(spec, f, indent=2)
            print(f"OpenAPI spec written to {output_file}")
    else:
        print(json.dumps(spec, indent=2))


if __name__ == "__main__":
    main()
