# Tools and Skills

Slice 1 triển khai registry tối thiểu và `read_file` v0.

- Agent runtime chỉ phụ thuộc `ToolResolver`/`ToolExecutor`.
- Registry validate input bằng Zod và chuẩn hóa `ToolResult`/`ToolError`.
- Tool chỉ đọc source qua `Workspace` port, không import filesystem adapter.
- Visibility filtering, policy engine, concurrency và artifact store đầy đủ thuộc Slice sau.
