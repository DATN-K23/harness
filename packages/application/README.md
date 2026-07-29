# Application

Các port hướng vào trong cho agent runtime và application use case.

Package này mô tả dependency mà core cần, resolve config đã validate, compose Judge prompt v0 và tạo immutable
`RunConfigSnapshot`. SDK model, filesystem, YAML parser, database và implementation của tool phải nằm sau các
interface.
