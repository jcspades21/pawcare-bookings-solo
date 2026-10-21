// =========================================================
// PawCare Bookings: simple rate limit
//
// Allows each visitor (by IP address) a set number of requests per
// time window on the routes it's attached to. Stops a script from
// flooding the booking list or guessing booking IDs.
// =========================================================

function rateLimit(options) {
    var max = options.max;
    var windowMs = options.windowMs;
    var hits = new Map();

    return function (req, res, next) {
        var now = Date.now();
        var key = req.ip;
        var recent = (hits.get(key) || []).filter(function (time) {
            return now - time < windowMs;
        });

        if (recent.length >= max) {
            var retryAfter = Math.ceil((windowMs - (now - recent[0])) / 1000);
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({
                ok: false,
                error: 'rate_limited',
                message: 'Too many requests. Please wait ' + retryAfter + ' seconds and try again.'
            });
        }

        recent.push(now);
        hits.set(key, recent);

        // Forget visitors who have gone quiet, so the map doesn't grow forever.
        if (hits.size > 5000) {
            hits.forEach(function (times, ip) {
                if (now - times[times.length - 1] >= windowMs) {
                    hits.delete(ip);
                }
            });
        }

        next();
    };
}

module.exports = rateLimit;
