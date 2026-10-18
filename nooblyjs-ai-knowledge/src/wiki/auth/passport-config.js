const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const fs = require('node:fs').promises;
const path = require('node:path');

const USERS_FILE = path.join(__dirname, '../../data/users.json');
const GOOGLE_CONFIG = {};

async function readUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function writeUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}

async function findUserById(id) {
  const users = await readUsers();
  return users.find(user => user.id === id);
}

async function findUserByEmail(email) {
  const users = await readUsers();
  return users.find(user => user.email === email);
}

async function createUser(userData) {
  const users = await readUsers();
  const newUser = {
    id: Date.now().toString(),
    ...userData,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  await writeUsers(users);
  return newUser;
}

function configurePassport(passport, authService) {
  // If authService is provided, use it for passport configuration
  // Otherwise fall back to file-based system for backward compatibility

  passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
  }, async (email, password, done) => {
    try {
      const user = await findUserByEmail(email);
      if (!user) {
        return done(null, false, { message: 'No user with that email' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (isMatch) {
        return done(null, user);
      } else {
        return done(null, false, { message: 'Password incorrect' });
      }
    } catch (error) {
      return done(error);
    }
  }));

  // Only configure Google OAuth if credentials are available
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await findUserByEmail(profile.emails[0].value);

        if (user) {
          return done(null, user);
        } else {
          user = await createUser({
            email: profile.emails[0].value,
            name: profile.displayName,
            googleId: profile.id,
            provider: 'google',
            avatar: profile.photos[0].value
          });
          return done(null, user);
        }
      } catch (error) {
        return done(error, null);
      }
    }));
  }

  passport.serializeUser((user, done) => {
    // Serialize by username if using core auth service, otherwise by id
    // Core auth service user objects have 'username' property
    const identifier = user.username || user.id;
    done(null, identifier);
  });

  // Mark that authService has been configured for this Passport instance
  if (authService) {
    authService._passportConfigured = true;
  }

  passport.deserializeUser(async (identifier, done) => {
    try {
      // If authService is provided, use it to look up users
      if (authService && typeof authService.getUser === 'function') {
        try {
          const user = await authService.getUser(identifier);
          done(null, user);
        } catch (error) {
          // User not found in core auth service, fall back to file system
          const user = await findUserById(identifier);
          if (!user) {
            return done(null, null);
          }
          done(null, user);
        }
      } else {
        // Fall back to file-based system
        const user = await findUserById(identifier);
        done(null, user);
      }
    } catch (error) {
      done(error, null);
    }
  });
}

module.exports = {
  configurePassport,
  findUserByEmail,
  createUser,
  readUsers,
  writeUsers
};