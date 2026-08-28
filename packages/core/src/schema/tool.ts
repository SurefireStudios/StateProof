import { z } from 'zod';
import { JsonObjectSchema } from '../json';
import { NonEmptyStringSchema, SchemaVersionSchema } from '../common';

/**
 * `read` tools may be used by StateProof evidence collection.
 * `write` tools mutate the sandbox and are never callable by an evidence tool.
 */
export const ToolAccessSchema = z.enum(['read', 'write']);
export type ToolAccess = z.infer<typeof ToolAccessSchema>;

export const ToolNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/, 'tool names look like "refund.execute"');

export const ToolDefinitionSchema = z
  .object({
    name: ToolNameSchema,
    description: NonEmptyStringSchema,
    access: ToolAccessSchema,
    parameters: JsonObjectSchema,
    returns: JsonObjectSchema.optional(),
  })
  .strict();

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ToolRegistrySchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    tools: z.array(ToolDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((registry, ctx) => {
    const seen = new Set<string>();
    for (const [index, tool] of registry.tools.entries()) {
      if (seen.has(tool.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tools', index, 'name'],
          message: `duplicate tool name "${tool.name}"`,
        });
      }
      seen.add(tool.name);
    }
  });

export type ToolRegistry = z.infer<typeof ToolRegistrySchema>;

export function findTool(registry: ToolRegistry, name: string): ToolDefinition | undefined {
  return registry.tools.find((tool) => tool.name === name);
}

export function readOnlyTools(registry: ToolRegistry): ToolDefinition[] {
  return registry.tools.filter((tool) => tool.access === 'read');
}
