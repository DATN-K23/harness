import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin: "*",
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(
    `Audit Harness API Service running on http://localhost:${port}/api/v1`,
  );
}

bootstrap();
