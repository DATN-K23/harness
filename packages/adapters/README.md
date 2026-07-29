# Adapters

Implementation tối thiểu cho các port của Slice 1:

- in-memory run repository và event store;
- deterministic clock và ID generator cho test;
- filesystem source workspace bị giới hạn trong source root;
- YAML config source validate bốn file WP5 trước khi giao cho application.

Production database và provider adapter chưa thuộc WP4.
