// =========================================================
// PawCare Bookings: shop rules
//
// The one place where services, opening hours and slot times are
// defined. The server uses these to check bookings, and the browser
// loads them from GET /api/config, so adding a service or changing
// the hours only means editing this file.
// =========================================================

module.exports = {
    timeZone: 'Asia/Manila',

    // 30-minute slots, 9AM-5PM, with a 12:00-1:00 lunch break carved out.
    slotTimes: [
        '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
        '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
    ],
    closingTime: '17:00',

    // Sanitation and setup time kept free after every appointment.
    bufferMinutes: 15,

    // How far ahead a visitor can book.
    maxDaysAhead: 365,

    services: {
        bath: { label: 'Basic Bath & Dry', minutes: 30, price: 350 },
        'full-groom': { label: 'Full Groom Package', minutes: 90, price: 850 },
        'nail-trim': { label: 'Nail Trim & Ear Cleaning', minutes: 20, price: 200 }
    },

    petSizes: ['small', 'medium', 'large'],

    addons: {
        perfume: 'Pet Cologne',
        teeth: 'Teeth Brushing',
        deshed: 'De-shedding Treatment'
    },

    contactMethods: ['email', 'phone']
};
