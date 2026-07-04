//! Campaign config — port of `src/game/progression.ts`: the shape menu, chapters, mechanic
//! densities, level seeds (xmur3), the par floor, and the difficulty curve. These constants
//! are shared with JS and G5-checked; `seedForLevel` is exact (integer hash), while
//! `targetPercentile` goes through `pow` and is only tolerance-comparable cross-language
//! (deterministic across our own targets via libm — see `jsnum`).

use crate::generator::DEFAULT_CAPACITY;
use crate::jsnum::{js_round, pow};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Family {
    Small,
    Tall,
    Medium,
    Large,
}

impl Family {
    pub fn name(self) -> &'static str {
        match self {
            Family::Small => "small",
            Family::Tall => "tall",
            Family::Medium => "medium",
            Family::Large => "large",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Shape {
    pub family: Family,
    pub bottles: usize,
    pub colors: usize,
    pub capacity: u8,
}

/// The shape menu — must stay in the exact order of `SHAPES` in `progression.ts` (bake pool
/// assembly order depends on it).
pub const SHAPES: [Shape; 10] = [
    Shape { family: Family::Small, bottles: 5, colors: 3, capacity: 4 },
    Shape { family: Family::Small, bottles: 5, colors: 4, capacity: 4 },
    Shape { family: Family::Tall, bottles: 5, colors: 3, capacity: 6 },
    Shape { family: Family::Tall, bottles: 5, colors: 4, capacity: 6 },
    Shape { family: Family::Tall, bottles: 5, colors: 4, capacity: 8 },
    Shape { family: Family::Tall, bottles: 5, colors: 4, capacity: 10 },
    Shape { family: Family::Medium, bottles: 10, colors: 7, capacity: 4 },
    Shape { family: Family::Medium, bottles: 10, colors: 8, capacity: 4 },
    Shape { family: Family::Large, bottles: 15, colors: 11, capacity: 4 },
    Shape { family: Family::Large, bottles: 15, colors: 12, capacity: 4 },
];

pub const CHAPTER_LEN: usize = 60;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mechanic {
    Hidden,
    Funnel,
    Ice,
}

/// Cumulative mechanic sets by chapter (chapter 0 = base game).
pub const MECHANIC_SETS: [&[Mechanic]; 4] = [
    &[],
    &[Mechanic::Hidden],
    &[Mechanic::Hidden, Mechanic::Funnel],
    &[Mechanic::Hidden, Mechanic::Funnel, Mechanic::Ice],
];

pub const DEFINED_CHAPTERS: usize = MECHANIC_SETS.len();
pub const CAMPAIGN_LENGTH: usize = DEFINED_CHAPTERS * CHAPTER_LEN;

pub fn chapter_for_level(level: usize) -> usize {
    let idx = level.saturating_sub(1);
    (idx / CHAPTER_LEN).min(DEFINED_CHAPTERS - 1)
}

pub fn mechanics_for_level(level: usize) -> &'static [Mechanic] {
    MECHANIC_SETS[chapter_for_level(level)]
}

/// Per-mechanic application density (the `prob` fed to each compute*).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MechanicDensity {
    pub hidden: f64,
    pub funnel: f64,
    pub ice: f64,
}

const SIGNATURE_DENSITY: MechanicDensity = MechanicDensity { hidden: 0.7, funnel: 0.62, ice: 0.8 };
const INHERITED_DENSITY: MechanicDensity = MechanicDensity { hidden: 0.15, funnel: 0.3, ice: 0.3 };
const BALANCED_DENSITY: MechanicDensity = MechanicDensity { hidden: 0.3, funnel: 0.5, ice: 0.5 };

/// The mechanic a chapter INTRODUCES (last in its cumulative set).
pub fn signature_mechanic(chapter: usize) -> Option<Mechanic> {
    MECHANIC_SETS[chapter.min(DEFINED_CHAPTERS - 1)].last().copied()
}

pub fn campaign_density(chapter: usize) -> MechanicDensity {
    let sig = signature_mechanic(chapter);
    MechanicDensity {
        hidden: if sig == Some(Mechanic::Hidden) { SIGNATURE_DENSITY.hidden } else { INHERITED_DENSITY.hidden },
        funnel: if sig == Some(Mechanic::Funnel) { SIGNATURE_DENSITY.funnel } else { INHERITED_DENSITY.funnel },
        ice: if sig == Some(Mechanic::Ice) { SIGNATURE_DENSITY.ice } else { INHERITED_DENSITY.ice },
    }
}

pub fn balanced_density() -> MechanicDensity {
    BALANCED_DENSITY
}

/// Chapter index and 0-based within-chapter position, plateau-clamped.
pub fn chapter_pos(level: usize) -> (usize, usize) {
    let idx = level.saturating_sub(1);
    let raw = idx / CHAPTER_LEN;
    if raw >= DEFINED_CHAPTERS {
        (DEFINED_CHAPTERS - 1, CHAPTER_LEN - 1)
    } else {
        (raw, idx % CHAPTER_LEN)
    }
}

/// xmur3 string hash → 32-bit seed — bit-exact port (JS `Math.imul` / rotate semantics).
fn xmur3(s: &str) -> u32 {
    let bytes = s.as_bytes();
    let mut h: u32 = 1779033703 ^ bytes.len() as u32;
    for &b in bytes {
        h = (h ^ b as u32).wrapping_mul(3432918353);
        h = h.rotate_left(13);
    }
    h = (h ^ (h >> 16)).wrapping_mul(2246822507);
    h = (h ^ (h >> 13)).wrapping_mul(3266489909);
    h ^ (h >> 16)
}

/// Deterministic seed for a level (`seedForLevel`).
pub fn seed_for_level(level: usize, salt: u32) -> u32 {
    xmur3(&format!("magic-color:L{level}:{salt}"))
}

/// Par floor: reject trivial boards, ramping mildly across the chapter (`parFloorFor`).
pub fn par_floor_for(colors: usize, pos_in_chapter: usize) -> u32 {
    let base = js_round(colors as f64 * 1.3);
    let ramp = js_round((pos_in_chapter as f64 / CHAPTER_LEN as f64) * colors as f64 * 0.8);
    (base + ramp) as u32
}

/// Difficulty-curve knobs (`CURVE`).
const BASE_FLOOR: f64 = 0.15;
const CHAPTER_FLOOR_STEP: f64 = 0.12;
const SPAN: f64 = 0.7;
const EASE_EXP: f64 = 1.6;

/// Where a level should sit on its chapter's score distribution, as a percentile in [0, 1].
/// Goes through `pow` — tolerance-compare cross-language (see module docs).
pub fn target_percentile(level: usize) -> f64 {
    let (chapter, pos) = chapter_pos(level);
    let t = if CHAPTER_LEN <= 1 { 0.0 } else { pos as f64 / (CHAPTER_LEN - 1) as f64 };
    let eased = pow(t, EASE_EXP);
    let p = BASE_FLOOR + chapter as f64 * CHAPTER_FLOOR_STEP + eased * SPAN;
    p.clamp(0.0, 1.0)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Easy,
    Normal,
    Hard,
}

impl Phase {
    pub fn name(self) -> &'static str {
        match self {
            Phase::Easy => "easy",
            Phase::Normal => "normal",
            Phase::Hard => "hard",
        }
    }
}

pub fn phase_for_level(level: usize) -> Phase {
    let p = target_percentile(level);
    if p < 1.0 / 3.0 {
        Phase::Easy
    } else if p < 2.0 / 3.0 {
        Phase::Normal
    } else {
        Phase::Hard
    }
}

/// Whether the bake measures exact (BFS) par for a shape (`planForLevel`'s parMode rule).
pub fn exact_par_shape(bottles: usize, capacity: u8) -> bool {
    bottles <= 6 && capacity <= DEFAULT_CAPACITY
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chapters_and_plateau() {
        assert_eq!(chapter_for_level(1), 0);
        assert_eq!(chapter_for_level(60), 0);
        assert_eq!(chapter_for_level(61), 1);
        assert_eq!(chapter_for_level(240), 3);
        assert_eq!(chapter_for_level(999), 3);
        assert_eq!(chapter_pos(999), (3, 59)); // plateau clamps to the chapter's end
    }

    #[test]
    fn densities_follow_signature_role() {
        assert_eq!(campaign_density(1).hidden, 0.7); // hidden is chapter 1's signature
        assert_eq!(campaign_density(2).hidden, 0.15); // inherited thereafter
        assert_eq!(campaign_density(2).funnel, 0.62);
        assert_eq!(campaign_density(3).ice, 0.8);
    }

    #[test]
    fn curve_is_monotone_within_a_chapter() {
        for lvl in 1..60 {
            assert!(target_percentile(lvl + 1) >= target_percentile(lvl));
        }
        // Later chapters start above earlier ones' floors.
        assert!(target_percentile(61) > target_percentile(1));
    }
}
