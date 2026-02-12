/**
 * MCP Tool Input Validation
 *
 * Validates tool call arguments against JSON Schema definitions.
 */

import type { McpTool, McpToolParameter } from "./types";
import { ToolValidationError, type ValidationErrorDetail } from "./errors";

// =============================================================================
// Types
// =============================================================================

export interface ToolInputValidationResult {
  valid: boolean;
  errors: ValidationErrorDetail[];
}

// =============================================================================
// Validator
// =============================================================================

/**
 * Validate tool call arguments against the tool's input schema.
 */
export function validateToolInput(
  tool: McpTool,
  args: Record<string, unknown>,
): ToolInputValidationResult {
  const errors: ValidationErrorDetail[] = [];
  const { properties, required } = tool.inputSchema;

  // Check required fields
  if (required) {
    for (const field of required) {
      if (args[field] === undefined || args[field] === null) {
        errors.push({
          field,
          message: `Required field "${field}" is missing`,
          expected: properties[field]?.type,
          received: undefined,
        });
      }
    }
  }

  // Check provided fields against schema
  for (const [key, value] of Object.entries(args)) {
    const paramSchema = properties[key];

    // Unknown field — skip (allow extra fields for forward compatibility)
    if (!paramSchema) continue;

    // Validate type
    const typeError = validateType(key, value, paramSchema);
    if (typeError) {
      errors.push(typeError);
      continue; // skip further checks on this field
    }

    // Validate enum
    if (paramSchema.enum && !paramSchema.enum.includes(value as string)) {
      errors.push({
        field: key,
        message: `Value must be one of: ${paramSchema.enum.join(", ")}`,
        expected: paramSchema.enum.join(" | "),
        received: value,
      });
    }

    // Validate array items type
    if (paramSchema.type === "array" && Array.isArray(value) && paramSchema.items) {
      const itemType = paramSchema.items.type;
      for (let i = 0; i < value.length; i++) {
        const actualType = getActualType(value[i]);
        if (actualType !== itemType) {
          errors.push({
            field: `${key}[${i}]`,
            message: `Array item must be of type "${itemType}", got "${actualType}"`,
            expected: itemType,
            received: value[i],
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate input and throw ToolValidationError if invalid.
 */
export function assertValidToolInput(
  tool: McpTool,
  args: Record<string, unknown>,
): void {
  const result = validateToolInput(tool, args);
  if (!result.valid) {
    throw new ToolValidationError(tool.name, result.errors);
  }
}

// =============================================================================
// Type Validation Helpers
// =============================================================================

function validateType(
  field: string,
  value: unknown,
  schema: McpToolParameter,
): ValidationErrorDetail | null {
  const actualType = getActualType(value);
  const expectedType = schema.type;

  // Allow number coercion from string
  if (expectedType === "number" && typeof value === "string") {
    const num = Number(value);
    if (!isNaN(num)) return null;
  }

  // Allow boolean coercion from string
  if (expectedType === "boolean" && typeof value === "string") {
    if (value === "true" || value === "false") return null;
  }

  if (actualType !== expectedType) {
    return {
      field,
      message: `Expected type "${expectedType}", got "${actualType}"`,
      expected: expectedType,
      received: value,
    };
  }

  return null;
}

function getActualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
