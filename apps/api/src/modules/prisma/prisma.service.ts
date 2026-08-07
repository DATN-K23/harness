import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
    // WAL Mode và busy_timeout cho SQLite concurrency
    await this.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
    await this.$executeRawUnsafe("PRAGMA busy_timeout = 5000;");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
