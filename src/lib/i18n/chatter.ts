import type { Lang } from "./lang.ts";

/**
 * What the people strolling about the map say when tapped, or now and then on
 * their own: everyday moments of a hospital visit, warm and a little funny.
 * Real tips from the hospital's own questions & answers are mixed in by the map.
 */
export const CHATTER: Record<Lang, string[]> = {
  id: [
    "Aduh, kartu BPJS-nya ketinggalan di motor…",
    "Kantinnya enak lho, coba nasi kuningnya.",
    "Alhamdulillah, anak saya sudah sembuh 😊",
    "Nomor antrean saya masih lama, ngopi dulu ah.",
    "Permisi, Poli Anak lewat mana ya?",
    "Jangan lupa cuci tangan, ya!",
    "Bawa air minum, cuacanya panas sekali hari ini.",
    "Saya cuma antar ibu kontrol.",
    "Wah, parkirannya penuh hari ini.",
    "Semoga cepat sembuh, Pak!",
    "Kata dokter, banyak istirahat dan minum air.",
    "Hari ini ramai, tapi antreannya cepat kok.",
    "Pakai aplikasi ini, nggak nyasar lagi 😄",
    "Resepnya ditebus di apotek dulu.",
    "Sudah sarapan? Jangan periksa perut kosong.",
    "Senyum dulu, biar cepat sembuh 🙂",
  ],
  en: [
    "Oh no, I left my BPJS card on the motorbike…",
    "The canteen's good, try the nasi kuning.",
    "Thank God, my child is well again 😊",
    "My number's a while off, coffee first.",
    "Excuse me, which way to the children's clinic?",
    "Don't forget to wash your hands!",
    "Bring water, it's really hot today.",
    "I'm just taking my mother to her check-up.",
    "Wow, the car park is full today.",
    "Get well soon, sir!",
    "Doctor says: plenty of rest and water.",
    "Busy today, but the queue moves fast.",
    "With this app I don't get lost any more 😄",
    "First the pharmacy, to fill the prescription.",
    "Had breakfast? Don't come in on an empty stomach.",
    "Smile, it helps you get better 🙂",
  ],
};

/** Lines of their own for children, older people and the hospital's cats. */
export const CHATTER_BY: Record<"child" | "elder" | "cat", Record<Lang, string[]>> = {
  child: {
    id: ["Ma, nanti beli es krim ya! 🍦", "Aku nggak takut disuntik kok!", "Wah, ada kucing! 🐱", "Masih jauh nggak, Pa?", "Aku mau jadi dokter nanti!"],
    en: ["Mum, ice cream after, okay? 🍦", "I'm not scared of injections!", "Look, a cat! 🐱", "Are we there yet, Dad?", "I want to be a doctor one day!"],
  },
  elder: {
    id: ["Pelan-pelan saja, Nak, lutut saya…", "Dulu rumah sakit ini belum sebesar ini.", "Obat darah tingginya jangan lupa diminum.", "Cucu saya yang pasang aplikasinya 😄"],
    en: ["Slowly now, my knees…", "This hospital wasn't this big in my day.", "Don't forget the blood pressure pills.", "My grandchild put this app on for me 😄"],
  },
  cat: {
    id: ["Meong~ 🐱", "Mrrr… ada ikan asin?", "Meong! (Ini lantai saya.)", "Zzz… jangan ganggu, lagi jaga IGD 😼", "Meong? Kantin ke arah sana."],
    en: ["Meow~ 🐱", "Mrrr… any salted fish?", "Meow! (This is my floor.)", "Zzz… don't disturb, I'm guarding the ER 😼", "Meow? The canteen's that way."],
  },
};
