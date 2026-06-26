//! 核心服务层模块声明
//!
//! 严格遵循 `03_CORE_ARCHITECTURE.md` §1 物理工程目录布局：
//! `core/` 下包含 capture / ocr / distill / embedding / mascot 五个模块。
pub mod capture;
pub mod ocr;
pub mod mascot;
pub mod distill;
pub mod embedding;
pub mod report;
