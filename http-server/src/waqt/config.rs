/// Prayer calculation method profiles and configuration types.
use serde::{Deserialize, Serialize};

/// 14-f64 config layout for the computation engine.
/// [0]=lat, [1]=lng, [2]=fajr_angle, [3]=isha_angle, [4]=isha_interval (NaN=by angle),
/// [5]=elevation, [6..11]=adjustments (fajr,sunrise,dhuhr,asr,maghrib,isha) in minutes,
/// [12]=shadow_factor (1=standard, 2=hanafi), [13]=high_lat_rule (0=none, 1=middle, 2=seventh, 3=angle).
pub type Config14 = [f64; 14];

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MethodAngles {
    pub fajr: f64,
    pub isha: f64,
    /// Minutes from maghrib (None = use isha angle).
    pub isha_interval: Option<f64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Adjustments {
    pub fajr: f64,
    pub sunrise: f64,
    pub dhuhr: f64,
    pub asr: f64,
    pub maghrib: f64,
    pub isha: f64,
}

impl Default for Adjustments {
    fn default() -> Self {
        Self {
            fajr: 0.0,
            sunrise: 0.0,
            dhuhr: 0.0,
            asr: 0.0,
            maghrib: 0.0,
            isha: 0.0,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Madhab {
    #[default]
    Standard,
    Hanafi,
}

impl Madhab {
    pub fn shadow_factor(self) -> f64 {
        match self {
            Self::Standard => 1.0,
            Self::Hanafi => 2.0,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HighLatRule {
    None,
    #[default]
    MiddleOfNight,
    SeventhOfNight,
    TwilightAngle,
}

impl HighLatRule {
    pub fn as_f64(self) -> f64 {
        match self {
            Self::None => 0.0,
            Self::MiddleOfNight => 1.0,
            Self::SeventhOfNight => 2.0,
            Self::TwilightAngle => 3.0,
        }
    }
}

/// 23 method profiles (Sunni only — no Jafari/Tehran).
pub struct MethodProfile;

impl MethodProfile {
    // ── Aladhan ID 1 ──
    pub const KARACHI: MethodAngles = MethodAngles {
        fajr: 18.0,
        isha: 18.0,
        isha_interval: None,
    };
    // ── Aladhan ID 2 ──
    pub const ISNA: MethodAngles = MethodAngles {
        fajr: 15.0,
        isha: 15.0,
        isha_interval: None,
    };
    // ── Aladhan ID 3 ──
    pub const MWL: MethodAngles = MethodAngles {
        fajr: 18.0,
        isha: 17.0,
        isha_interval: None,
    };
    // ── Aladhan ID 4 ──
    pub const UMM_AL_QURA: MethodAngles = MethodAngles {
        fajr: 18.5,
        isha: 0.0,
        isha_interval: Some(90.0),
    };
    // ── Aladhan ID 5 ──
    pub const EGYPTIAN: MethodAngles = MethodAngles {
        fajr: 19.5,
        isha: 17.5,
        isha_interval: None,
    };
    // ── Aladhan ID 8 ──
    pub const GULF: MethodAngles = MethodAngles {
        fajr: 19.5,
        isha: 0.0,
        isha_interval: Some(90.0),
    };
    // ── Aladhan ID 9 ──
    pub const KUWAIT: MethodAngles = MethodAngles {
        fajr: 18.0,
        isha: 17.5,
        isha_interval: None,
    };
    // ── Aladhan ID 10 ──
    pub const QATAR: MethodAngles = MethodAngles {
        fajr: 18.0,
        isha: 0.0,
        isha_interval: Some(90.0),
    };
    // ── Aladhan ID 11 ──
    pub const SINGAPORE: MethodAngles = MethodAngles {
        fajr: 20.0,
        isha: 18.0,
        isha_interval: None,
    };
    // ── Aladhan ID 12 ──
    pub const FRANCE: MethodAngles = MethodAngles {
        fajr: 12.0,
        isha: 12.0,
        isha_interval: None,
    };
    // ── Aladhan ID 13 ──
    pub const TURKEY: MethodAngles = MethodAngles {
        fajr: 18.0,
        isha: 17.0,
        isha_interval: None,
    };
    // ── Aladhan ID 14 ──
    pub const RUSSIA: MethodAngles = MethodAngles {
        fajr: 16.0,
        isha: 15.0,
        isha_interval: None,
    };
    // ── Aladhan ID 15 ──
    pub const MOONSIGHTING_COMMITTEE: MethodAngles = MethodAngles {
        fajr: 18.0,
        isha: 18.0,
        isha_interval: None,
    };
    // ── Aladhan ID 16 ──
    pub const DUBAI: MethodAngles = MethodAngles {
        fajr: 18.2,
        isha: 18.2,
        isha_interval: None,
    };
    // ── Aladhan ID 17 ──
    pub const JAKIM: MethodAngles = MethodAngles {
        fajr: 20.0,
        isha: 18.0,
        isha_interval: None,
    };
    // ── Aladhan ID 18 ──
    pub const TUNISIA: MethodAngles = MethodAngles {
        fajr: 18.0,
        isha: 18.0,
        isha_interval: None,
    };
    // ── Aladhan ID 19 ──
    pub const ALGERIA: MethodAngles = MethodAngles {
        fajr: 18.0,
        isha: 17.0,
        isha_interval: None,
    };
    // ── Aladhan ID 20 ──
    pub const KEMENAG: MethodAngles = MethodAngles {
        fajr: 20.0,
        isha: 18.0,
        isha_interval: None,
    };
    // ── Aladhan ID 21 ──
    pub const MOROCCO: MethodAngles = MethodAngles {
        fajr: 19.0,
        isha: 17.0,
        isha_interval: None,
    };
    // ── Aladhan ID 22 ──
    pub const PORTUGAL: MethodAngles = MethodAngles {
        fajr: 18.0,
        isha: 0.0,
        isha_interval: Some(77.0),
    };
    // ── Aladhan ID 23 ──
    pub const JORDAN: MethodAngles = MethodAngles {
        fajr: 18.0,
        isha: 18.0,
        isha_interval: None,
    };
    // ── No Aladhan ID (legacy) ──
    pub const NORTH_AMERICA: MethodAngles = MethodAngles {
        fajr: 15.0,
        isha: 15.0,
        isha_interval: None,
    };

    /// Lookup by Aladhan numeric method ID.
    /// Returns (id, name, angles). Excludes 0=Jafari, 6=not used, 7=Tehran.
    pub fn by_id(id: u32) -> Option<(u32, &'static str, MethodAngles)> {
        match id {
            1 => Some((1, "University of Islamic Sciences, Karachi", Self::KARACHI)),
            2 => Some((2, "Islamic Society of North America (ISNA)", Self::ISNA)),
            3 => Some((3, "Muslim World League", Self::MWL)),
            4 => Some((4, "Umm Al-Qura University, Makkah", Self::UMM_AL_QURA)),
            5 => Some((5, "Egyptian General Authority of Survey", Self::EGYPTIAN)),
            8 => Some((8, "Gulf Region", Self::GULF)),
            9 => Some((9, "Kuwait", Self::KUWAIT)),
            10 => Some((10, "Qatar", Self::QATAR)),
            11 => Some((11, "Majlis Ugama Islam Singapura, Singapore", Self::SINGAPORE)),
            12 => Some((12, "Union Organization Islamic de France", Self::FRANCE)),
            13 => Some((13, "Diyanet İşleri Başkanlığı, Turkey", Self::TURKEY)),
            14 => Some((14, "Spiritual Administration of Muslims of Russia", Self::RUSSIA)),
            15 => Some((15, "Moonsighting Committee Worldwide", Self::MOONSIGHTING_COMMITTEE)),
            16 => Some((16, "Dubai", Self::DUBAI)),
            17 => Some((17, "Jabatan Kemajuan Islam Malaysia (JAKIM)", Self::JAKIM)),
            18 => Some((18, "Tunisia", Self::TUNISIA)),
            19 => Some((19, "Algeria", Self::ALGERIA)),
            20 => Some((20, "KEMENAG - Kementerian Agama Republik Indonesia", Self::KEMENAG)),
            21 => Some((21, "Morocco", Self::MOROCCO)),
            22 => Some((22, "Comunidade Islamica de Lisboa, Portugal", Self::PORTUGAL)),
            23 => Some((23, "Ministry of Awqaf, Islamic Affairs and Holy Places, Jordan", Self::JORDAN)),
            _ => None,
        }
    }

    pub fn by_name(name: &str) -> Option<(&'static str, MethodAngles)> {
        let lower = name.to_ascii_lowercase();
        match lower.as_str() {
            "karachi" => Some(("Karachi", Self::KARACHI)),
            "turkey" => Some(("Turkey", Self::TURKEY)),
            "mwl" => Some(("MWL", Self::MWL)),
            "isna" => Some(("ISNA", Self::ISNA)),
            "egyptian" => Some(("Egyptian", Self::EGYPTIAN)),
            "ummalqura" | "umm_al_qura" => Some(("UmmAlQura", Self::UMM_AL_QURA)),
            "singapore" => Some(("Singapore", Self::SINGAPORE)),
            "dubai" => Some(("Dubai", Self::DUBAI)),
            "kuwait" => Some(("Kuwait", Self::KUWAIT)),
            "qatar" => Some(("Qatar", Self::QATAR)),
            "gulf" => Some(("Gulf", Self::GULF)),
            "france" => Some(("France", Self::FRANCE)),
            "russia" => Some(("Russia", Self::RUSSIA)),
            "jakim" => Some(("JAKIM", Self::JAKIM)),
            "tunisia" => Some(("Tunisia", Self::TUNISIA)),
            "algeria" => Some(("Algeria", Self::ALGERIA)),
            "kemenag" => Some(("KEMENAG", Self::KEMENAG)),
            "morocco" => Some(("Morocco", Self::MOROCCO)),
            "portugal" => Some(("Portugal", Self::PORTUGAL)),
            "jordan" => Some(("Jordan", Self::JORDAN)),
            "moonsightingcommittee" | "moonsighting" | "moonsighting_committee" => {
                Some(("MoonsightingCommittee", Self::MOONSIGHTING_COMMITTEE))
            }
            "northamerica" | "north_america" => Some(("NorthAmerica", Self::NORTH_AMERICA)),
            _ => None,
        }
    }

    /// Get the Aladhan method key string for a given method ID.
    pub fn key_for_id(id: u32) -> &'static str {
        match id {
            1 => "Karachi",
            2 => "ISNA",
            3 => "MWL",
            4 => "UmmAlQura",
            5 => "Egyptian",
            8 => "Gulf",
            9 => "Kuwait",
            10 => "Qatar",
            11 => "Singapore",
            12 => "France",
            13 => "Turkey",
            14 => "Russia",
            15 => "MoonsightingCommittee",
            16 => "Dubai",
            17 => "JAKIM",
            18 => "Tunisia",
            19 => "Algeria",
            20 => "KEMENAG",
            21 => "Morocco",
            22 => "Portugal",
            23 => "Jordan",
            _ => "Unknown",
        }
    }
}

/// Per-method minute adjustments (matches the JS METHOD_ADJUSTMENTS).
pub fn method_adjustments(method_key: &str) -> Adjustments {
    match method_key {
        "MWL" | "Egyptian" | "Karachi" | "NorthAmerica" | "Singapore" | "JAKIM" | "KEMENAG" => {
            Adjustments {
                dhuhr: 1.0,
                ..Default::default()
            }
        }
        "Dubai" => Adjustments {
            sunrise: -3.0,
            dhuhr: 3.0,
            asr: 3.0,
            maghrib: 3.0,
            ..Default::default()
        },
        "MoonsightingCommittee" => Adjustments {
            dhuhr: 5.0,
            maghrib: 3.0,
            ..Default::default()
        },
        "Turkey" => Adjustments {
            sunrise: -7.0,
            dhuhr: 5.0,
            asr: 4.0,
            maghrib: 7.0,
            ..Default::default()
        },
        _ => Adjustments::default(),
    }
}

/// Build the 14-f64 config array from structured inputs.
pub fn build_config14(
    lat: f64,
    lng: f64,
    method: &MethodAngles,
    adj: &Adjustments,
    madhab: Madhab,
    high_lat: HighLatRule,
    elevation: f64,
) -> Config14 {
    [
        lat,
        lng,
        method.fajr,
        method.isha,
        method.isha_interval.unwrap_or(f64::NAN),
        elevation,
        adj.fajr,
        adj.sunrise,
        adj.dhuhr,
        adj.asr,
        adj.maghrib,
        adj.isha,
        madhab.shadow_factor(),
        high_lat.as_f64(),
    ]
}
