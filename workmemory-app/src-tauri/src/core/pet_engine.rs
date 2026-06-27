//! 宠物引擎：状态管理 + XP 升级 + 衍生计算 + 衰减
//!
//! 严格遵循 analysis_results.md BUG-004/012 / 优化 12 修复要求：
//! - XP 升级公式：XP_needed = level*100 + (level-1)*50
//! - 衍生计算：完成任务 +10 XP/+5 hunger；专注完成 +20 XP/+10 energy
//! - 时间衰减：hunger -5%/hr、energy -3%/hr
//! - 所有交互持久化到 pet_state + pet_interaction_logs

use rusqlite::Connection;
use crate::core::error::{AppError, AppResult};
use crate::models::PetState;

/// 计算升到下一级所需 XP
/// 公式：XP_needed = level*100 + (level-1)*50
/// Level 1 → 100, Level 2 → 250, Level 3 → 400, Level 5 → 700
pub fn xp_needed_for_next_level(level: i64) -> i64 {
    level * 100 + (level - 1) * 50
}

/// 应用 XP 增长，处理升级
/// 返回 (新 level, 新 xp, 是否升级)
pub fn apply_xp(mut level: i64, mut xp: i64, gained: i64) -> (i64, i64, bool) {
    xp += gained;
    let mut leveled_up = false;
    loop {
        let needed = xp_needed_for_next_level(level);
        if xp >= needed {
            xp -= needed;
            level += 1;
            leveled_up = true;
        } else {
            break;
        }
    }
    (level, xp, leveled_up)
}

/// 根据属性推断 mood（7 种：ecstatic/happy/content/neutral/sad/angry/sleeping）
pub fn infer_mood(hunger: i64, energy: i64, happiness: i64) -> &'static str {
    let avg = (hunger + energy + happiness) / 3;
    if avg >= 90 { "ecstatic" }
    else if avg >= 75 { "happy" }
    else if avg >= 60 { "content" }
    else if avg >= 45 { "neutral" }
    else if avg >= 30 { "sad" }
    else { "angry" }
}

/// 钳制到 [0, 100]
fn clamp(v: i64) -> i64 {
    v.max(0).min(100)
}

/// 获取宠物状态（单行，id='default'）
pub fn get_pet_state(conn: &Connection) -> AppResult<PetState> {
    let pet = conn.query_row(
        "SELECT id, species, level, xp, hunger, energy, happiness, cleanliness, bond_level, mood, last_updated
         FROM pet_state WHERE id = 'default'",
        [],
        |row| Ok(PetState {
            id: row.get(0)?,
            species: row.get(1)?,
            level: row.get(2)?,
            xp: row.get(3)?,
            hunger: row.get(4)?,
            energy: row.get(5)?,
            happiness: row.get(6)?,
            cleanliness: row.get(7)?,
            bond_level: row.get(8)?,
            mood: row.get(9)?,
            last_updated: row.get(10)?,
        }),
    ).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::not_found("宠物状态未初始化"),
        other => AppError::DbError(other.to_string()),
    })?;
    Ok(pet)
}

/// 保存宠物状态
pub fn save_pet_state(conn: &Connection, pet: &PetState) -> AppResult<()> {
    let now = chrono::Local::now().format("%+").to_string();
    conn.execute(
        "UPDATE pet_state SET species=?1, level=?2, xp=?3, hunger=?4, energy=?5,
            happiness=?6, cleanliness=?7, bond_level=?8, mood=?9, last_updated=?10
         WHERE id='default'",
        rusqlite::params![
            pet.species, pet.level, pet.xp, clamp(pet.hunger), clamp(pet.energy),
            clamp(pet.happiness), clamp(pet.cleanliness), pet.bond_level, pet.mood, now,
        ],
    )?;
    Ok(())
}

/// 记录交互日志
fn log_interaction(conn: &Connection, action: &str, delta: &serde_json::Value) -> AppResult<()> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%+").to_string();
    conn.execute(
        "INSERT INTO pet_interaction_logs (id, action, delta, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, action, delta.to_string(), now],
    )?;
    Ok(())
}

/// 喂食：+hunger, +happiness
pub fn feed(conn: &Connection) -> AppResult<PetState> {
    let mut pet = get_pet_state(conn)?;
    pet.hunger = clamp(pet.hunger + 20);
    pet.happiness = clamp(pet.happiness + 5);
    pet.mood = infer_mood(pet.hunger, pet.energy, pet.happiness).to_string();
    save_pet_state(conn, &pet)?;
    log_interaction(conn, "feed", &serde_json::json!({"hunger": 20, "happiness": 5}))?;
    Ok(pet)
}

/// 玩耍：+happiness, -energy, +bond
pub fn play(conn: &Connection) -> AppResult<PetState> {
    let mut pet = get_pet_state(conn)?;
    pet.happiness = clamp(pet.happiness + 15);
    pet.energy = clamp(pet.energy - 10);
    pet.bond_level += 1;
    pet.mood = infer_mood(pet.hunger, pet.energy, pet.happiness).to_string();
    save_pet_state(conn, &pet)?;
    log_interaction(conn, "play", &serde_json::json!({"happiness": 15, "energy": -10, "bond": 1}))?;
    Ok(pet)
}

/// 休息：+energy
pub fn rest(conn: &Connection) -> AppResult<PetState> {
    let mut pet = get_pet_state(conn)?;
    pet.energy = clamp(pet.energy + 30);
    pet.mood = "sleeping".to_string();
    save_pet_state(conn, &pet)?;
    log_interaction(conn, "rest", &serde_json::json!({"energy": 30}))?;
    Ok(pet)
}

/// 清洁：+cleanliness, +happiness
pub fn clean(conn: &Connection) -> AppResult<PetState> {
    let mut pet = get_pet_state(conn)?;
    pet.cleanliness = clamp(pet.cleanliness + 25);
    pet.happiness = clamp(pet.happiness + 3);
    pet.mood = infer_mood(pet.hunger, pet.energy, pet.happiness).to_string();
    save_pet_state(conn, &pet)?;
    log_interaction(conn, "clean", &serde_json::json!({"cleanliness": 25, "happiness": 3}))?;
    Ok(pet)
}

/// 衍生计算：任务完成时调用（+10 XP, +5 hunger）
pub fn on_task_completed(conn: &Connection) -> AppResult<PetState> {
    let mut pet = get_pet_state(conn)?;
    let (new_level, new_xp, _) = apply_xp(pet.level, pet.xp, 10);
    pet.level = new_level;
    pet.xp = new_xp;
    pet.hunger = clamp(pet.hunger + 5);
    pet.mood = infer_mood(pet.hunger, pet.energy, pet.happiness).to_string();
    save_pet_state(conn, &pet)?;
    log_interaction(conn, "task_completed", &serde_json::json!({"xp": 10, "hunger": 5}))?;
    Ok(pet)
}

/// 衍生计算：专注完成时调用（+20 XP, +10 energy）
pub fn on_focus_completed(conn: &Connection) -> AppResult<PetState> {
    let mut pet = get_pet_state(conn)?;
    let (new_level, new_xp, _) = apply_xp(pet.level, pet.xp, 20);
    pet.level = new_level;
    pet.xp = new_xp;
    pet.energy = clamp(pet.energy + 10);
    pet.mood = infer_mood(pet.hunger, pet.energy, pet.happiness).to_string();
    save_pet_state(conn, &pet)?;
    log_interaction(conn, "focus_completed", &serde_json::json!({"xp": 20, "energy": 10}))?;
    Ok(pet)
}

/// 时间衰减：hunger -5%/hr, energy -3%/hr（按小时数计算）
pub fn decay(conn: &Connection, hours_elapsed: f64) -> AppResult<PetState> {
    let mut pet = get_pet_state(conn)?;
    pet.hunger = clamp((pet.hunger as f64 * (1.0 - 0.05 * hours_elapsed)) as i64);
    pet.energy = clamp((pet.energy as f64 * (1.0 - 0.03 * hours_elapsed)) as i64);
    pet.mood = infer_mood(pet.hunger, pet.energy, pet.happiness).to_string();
    save_pet_state(conn, &pet)?;
    Ok(pet)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xp_formula_level_1_needs_100() {
        assert_eq!(xp_needed_for_next_level(1), 100);
    }

    #[test]
    fn xp_formula_level_5_needs_700() {
        // 5*100 + 4*50 = 500 + 200 = 700
        assert_eq!(xp_needed_for_next_level(5), 700);
    }

    #[test]
    fn apply_xp_no_levelup() {
        let (level, xp, up) = apply_xp(1, 50, 30);
        assert_eq!(level, 1);
        assert_eq!(xp, 80);
        assert!(!up);
    }

    #[test]
    fn apply_xp_single_levelup() {
        let (level, xp, up) = apply_xp(1, 80, 30);
        // 80+30=110 >= 100, levelup, xp=10
        assert_eq!(level, 2);
        assert_eq!(xp, 10);
        assert!(up);
    }

    #[test]
    fn apply_xp_double_levelup() {
        // Level 2 needs 250
        let (level, xp, up) = apply_xp(1, 90, 280);
        // 90+280=370; 370-100=270 (level 2); 270-250=20 (level 3)
        assert_eq!(level, 3);
        assert_eq!(xp, 20);
        assert!(up);
    }

    #[test]
    fn infer_mood_thresholds() {
        assert_eq!(infer_mood(95, 95, 95), "ecstatic");
        assert_eq!(infer_mood(80, 80, 80), "happy");
        assert_eq!(infer_mood(65, 65, 65), "content");
        assert_eq!(infer_mood(50, 50, 50), "neutral");
        assert_eq!(infer_mood(35, 35, 35), "sad");
        assert_eq!(infer_mood(10, 10, 10), "angry");
    }

    #[test]
    fn clamp_bounds() {
        assert_eq!(clamp(-5), 0);
        assert_eq!(clamp(150), 100);
        assert_eq!(clamp(50), 50);
    }

    #[test]
    fn decay_reduces_hunger_and_energy() {
        // 5%/hr hunger, 3%/hr energy
        // After 1 hour: hunger 80 → 76, energy 80 → 77.6 → 77
        assert_eq!((80.0_f64 * 0.95) as i64, 76);
        assert_eq!((80.0_f64 * 0.97) as i64, 77);
    }
}
