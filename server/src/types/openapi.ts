// server/src/types/openapi.ts — Minimal OpenAPI 3.0 type stubs to avoid extra dependencies

export namespace OpenAPIV3 {
  export interface SchemaObject {
    type?: string;
    format?: string;
    properties?: Record<string, SchemaObject | { $ref: string }>;
    required?: string[];
    items?: SchemaObject | { $ref: string };
    enum?: string[];
    nullable?: boolean;
    example?: unknown;
    default?: unknown;
    description?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    $ref?: string;
    [key: string]: unknown;
  }

  export interface RequestBodyObject {
    required?: boolean;
    content: Record<string, { schema: SchemaObject }>;
  }

  export interface ResponseObject {
    description: string;
    content?: Record<string, { schema: SchemaObject | { $ref: string } }>;
  }

  export interface SecurityRequirementObject {
    [name: string]: string[];
  }
}
