function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in to access this.');
    }
    next();
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.session.userId) {
            return res.status(401).send('You must be logged in to access this.');
        }
        if (!allowedRoles.includes(req.session.role)) {
            return res.status(403).send('You do not have permission to access this.');
        }
        next();
    };
}

module.exports = { requireLogin, requireRole };
