// ─── NIGERIA LOCATION DATA ─────────────────────────
// Free. No API required. All 36 states + FCT with major cities.

export interface StateCity {
  state: string;
  cities: string[];
}

export const NIGERIA_STATES: StateCity[] = [
  {
    state: 'Abuja (FCT)',
    cities: ['Abuja', 'Gwagwalada', 'Kuje', 'Abaji', 'Bwari', 'Kwali'],
  },
  {
    state: 'Abia',
    cities: ['Umuahia', 'Aba', 'Ohafia', 'Arochukwu', 'Isuikwuato', 'Osisioma', 'Ukwa'],
  },
  {
    state: 'Adamawa',
    cities: ['Yola', 'Mubi', 'Jimeta', 'Numan', 'Ganye', 'Hong', 'Mayo-Belwa'],
  },
  {
    state: 'Akwa Ibom',
    cities: ['Uyo', 'Eket', 'Ikot Ekpene', 'Oron', 'Abak', 'Mkpat Enin', 'Itu'],
  },
  {
    state: 'Anambra',
    cities: ['Awka', 'Onitsha', 'Nnewi', 'Ekwulobia', 'Ihiala', 'Ogbaru', 'Orumba'],
  },
  {
    state: 'Bauchi',
    cities: ['Bauchi', 'Azare', 'Jama\'are', 'Katagum', 'Misau', 'Ningi', 'Tafawa Balewa'],
  },
  {
    state: 'Bayelsa',
    cities: ['Yenagoa', 'Brass', 'Ogbia', 'Nembe', 'Sagbama', 'Ekeremor', 'Southern Ijaw'],
  },
  {
    state: 'Benue',
    cities: ['Makurdi', 'Gboko', 'Otukpo', 'Katsina-Ala', 'Vandeikya', 'Oju', 'Logo'],
  },
  {
    state: 'Borno',
    cities: ['Maiduguri', 'Biu', 'Monguno', 'Dikwa', 'Bama', 'Gwoza', 'Konduga'],
  },
  {
    state: 'Cross River',
    cities: ['Calabar', 'Ikom', 'Ogoja', 'Ugep', 'Obudu', 'Akamkpa', 'Boki'],
  },
  {
    state: 'Delta',
    cities: ['Asaba', 'Warri', 'Sapele', 'Ughelli', 'Agbor', 'Oleh', 'Burutu'],
  },
  {
    state: 'Ebonyi',
    cities: ['Abakaliki', 'Afikpo', 'Onueke', 'Ishielu', 'Izzi', 'Ezza', 'Ohaukwu'],
  },
  {
    state: 'Edo',
    cities: ['Benin City', 'Auchi', 'Ekpoma', 'Igarra', 'Uromi', 'Sabongida-Ora', 'Igueben'],
  },
  {
    state: 'Ekiti',
    cities: ['Ado-Ekiti', 'Ikere-Ekiti', 'Ijero', 'Oye', 'Ikole', 'Emure', 'Ise'],
  },
  {
    state: 'Enugu',
    cities: ['Enugu', 'Nsukka', 'Agbani', 'Udi', 'Oji-River', 'Awgu', 'Nkanu'],
  },
  {
    state: 'Gombe',
    cities: ['Gombe', 'Kumo', 'Billiri', 'Dukku', 'Nafada', 'Yamaltu/Deba', 'Funakaye'],
  },
  {
    state: 'Imo',
    cities: ['Owerri', 'Orlu', 'Okigwe', 'Mgbidi', 'Oguta', 'Mbano', 'Nkwerre'],
  },
  {
    state: 'Jigawa',
    cities: ['Dutse', 'Hadejia', 'Gumel', 'Birnin Kudu', 'Kazaure', 'Babura', 'Ringim'],
  },
  {
    state: 'Kaduna',
    cities: ['Kaduna', 'Zaria', 'Kafanchan', 'Saminaka', 'Kagoro', 'Ikara', 'Giwa'],
  },
  {
    state: 'Kano',
    cities: ['Kano', 'Wudil', 'Bichi', 'Rano', 'Gaya', 'Dambatta', 'Ungogo'],
  },
  {
    state: 'Katsina',
    cities: ['Katsina', 'Daura', 'Funtua', 'Malumfashi', 'Dutsin-Ma', 'Mani', 'Bakori'],
  },
  {
    state: 'Kebbi',
    cities: ['Birnin Kebbi', 'Argungu', 'Yauri', 'Zuru', 'Jega', 'Koko', 'Bagudo'],
  },
  {
    state: 'Kogi',
    cities: ['Lokoja', 'Anyigba', 'Okene', 'Idah', 'Kabba', 'Dekina', 'Ajaokuta'],
  },
  {
    state: 'Kwara',
    cities: ['Ilorin', 'Offa', 'Jebba', 'Lafiagi', 'Kaiama', 'Omu-Aran', 'Share'],
  },
  {
    state: 'Lagos',
    cities: ['Ikeja', 'Lekki', 'Victoria Island', 'Yaba', 'Surulere', 'Ikorodu', 'Epe', 'Badagry', 'Festac', 'Gbagada', 'Oshodi', 'Apapa'],
  },
  {
    state: 'Nasarawa',
    cities: ['Lafia', 'Keffi', 'Akwanga', 'Nasarawa', 'Karu', 'Doma', 'Wamba'],
  },
  {
    state: 'Niger',
    cities: ['Minna', 'Bida', 'Suleja', 'Kontagora', 'Lapai', 'New Bussa', 'Agaie'],
  },
  {
    state: 'Ogun',
    cities: ['Abeokuta', 'Ijebu-Ode', 'Sagamu', 'Ilaro', 'Sango-Ota', 'Ijebu-Igbo', 'Ayetoro'],
  },
  {
    state: 'Ondo',
    cities: ['Akure', 'Ondo', 'Owo', 'Ikare', 'Ore', 'Idanre', 'Okitipupa'],
  },
  {
    state: 'Osun',
    cities: ['Osogbo', 'Ile-Ife', 'Ilesa', 'Ede', 'Ikirun', 'Iwo', 'Ejigbo'],
  },
  {
    state: 'Oyo',
    cities: ['Ibadan', 'Ogbomoso', 'Oyo', 'Iseyin', 'Saki', 'Eruwa', 'Kisi'],
  },
  {
    state: 'Plateau',
    cities: ['Jos', 'Bukuru', 'Pankshin', 'Shendam', 'Langtang', 'Bassa', 'Mangu'],
  },
  {
    state: 'Rivers',
    cities: ['Port Harcourt', 'Obio/Akpor', 'Oyigbo', 'Ikwerre', 'Okrika', 'Eleme', 'Bonny'],
  },
  {
    state: 'Sokoto',
    cities: ['Sokoto', 'Tambuwal', 'Gwadabawa', 'Wurno', 'Bodinga', 'Yabo', 'Shagari'],
  },
  {
    state: 'Taraba',
    cities: ['Jalingo', 'Wukari', 'Bali', 'Zing', 'Takum', 'Gembu', 'Lau'],
  },
  {
    state: 'Yobe',
    cities: ['Damaturu', 'Potiskum', 'Nguru', 'Gashua', 'Bade', 'Fika', 'Gujba'],
  },
  {
    state: 'Zamfara',
    cities: ['Gusau', 'Kaura Namoda', 'Talata Mafara', 'Anka', 'Maru', 'Bakura', 'Shinkafi'],
  },
];

export function getAllStates(): string[] {
  return NIGERIA_STATES.map((s) => s.state);
}

export function getCitiesForState(state: string): string[] {
  const found = NIGERIA_STATES.find((s) => s.state === state);
  return found?.cities || [];
}

export function getStateForCity(city: string): string | null {
  for (const sc of NIGERIA_STATES) {
    if (sc.cities.includes(city)) return sc.state;
  }
  return null;
}

// User-friendly location label
export function formatLocation(country: string, state: string, city: string, area?: string | null): string {
  const parts = [city, state, country].filter(Boolean);
  if (area) parts.splice(1, 0, area);
  return parts.join(', ');
}

// Quick match: same city check
export function isSameCity(a: { city?: string | null; state?: string | null }, b: { city?: string | null; state?: string | null }): boolean {
  return !!a.city && !!b.city && a.city === b.city;
}

export function isSameState(a: { state?: string | null }, b: { state?: string | null }): boolean {
  return !!a.state && !!b.state && a.state === b.state;
}
