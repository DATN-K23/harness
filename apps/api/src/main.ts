import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  // I1 Fix: Validate biến môi trường bắt buộc trước khi khởi tạo app
  // Fail fast với message rõ ràng thay vì crash lạ bên trong Prisma/NestJS
  if (!process.env.DATABASE_URL) {
    console.error(
      "[FATAL] Biến môi trường DATABASE_URL chưa được thiết lập.\n" +
        "  → Copy apps/api/.env.example → apps/api/.env rồi chạy lại.\n" +
        "  → Ví dụ: DATABASE_URL=\"file:./dev.db\"",
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");

  /**
   * NI4 Fix: credentials: true + origin: "*" là invalid CORS — browser block.
   * - Development: origin "*", credentials false (dùng Vite proxy thay thế)
   * - Production: origin từ CORS_ORIGIN env, credentials true nếu cần
   */
  const isProduction = process.env.NODE_ENV === "production";
  const corsOrigin = process.env.CORS_ORIGIN;

  if (isProduction && corsOrigin) {
    app.enableCors({ origin: corsOrigin, credentials: true });
  } else {
    // Development: Vite proxy handle CORS, API chỉ cần allow localhost
    app.enableCors({ origin: true, credentials: false });
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(
    `Audit Harness API Service running on http://localhost:${port}/api/v1`,
  );
}

bootstrap();

