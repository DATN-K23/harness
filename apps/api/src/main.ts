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
  app.enableCors({
    // Production: thay '*' bằng origin cụ thể (vd: process.env.FRONTEND_URL)
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(
    `Audit Harness API Service running on http://localhost:${port}/api/v1`,
  );
}

bootstrap();

