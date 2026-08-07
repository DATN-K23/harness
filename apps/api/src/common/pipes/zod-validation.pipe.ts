import {
  PipeTransform,
  ArgumentMetadata,
  BadRequestException,
} from "@nestjs/common";
import { ZodSchema, ZodError } from "zod";

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.errors.map((e) => ({
          field: e.path.join("."),
          issue: e.message,
        }));
        throw new BadRequestException({
          errorCode: "ERR_VALIDATION_FAILED",
          message: "Invalid request body parameters",
          details,
        });
      }
      throw new BadRequestException("Validation failed");
    }
  }
}
