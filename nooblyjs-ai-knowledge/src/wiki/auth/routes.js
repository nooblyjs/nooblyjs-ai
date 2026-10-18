/**
 * @fileoverview Authentication Routes (Wrapper for AuthService APIs)
 * Delegates to digital-technologies-core authservice routes
 * The authservice provides all auth endpoints at /services/authservice/api/*
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const express = require('express');
const passport = require('passport');

const router = express.Router();

/**
 * POST /auth/login
 * Proxy to authservice login endpoint
 * Includes wizard status check after authentication
 */
router.post('/login', (req, res, next) => {
  passport.authenticate('local', async (err, user, info) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
    if (!user) {
      return res.status(401).json({
        success: false,
        message: info.message || 'Invalid credentials'
      });
    }

    // Log the user in with Passport
    req.logIn(user, async (err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: 'Error logging in'
        });
      }

      // Check wizard status
      const userInitializer = req.app.locals.userInitializer;
      let needsWizard = false;

      if (userInitializer) {
        needsWizard = !(await userInitializer.isInitialized(user.username));
      }

      return res.json({
        success: true,
        needsWizard,
        user: {
          username: user.username,
          email: user.email,
          role: user.role
        }
      });
    });
  })(req, res, next);
});

/**
 * POST /auth/logout
 * Logout the current user and destroy session
 */
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: 'Error logging out'
      });
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: 'Error destroying session'
        });
      }
      res.json({ success: true });
    });
  });
});

/**
 * GET /auth/check
 * Check authentication status and wizard status
 */
router.get('/check', async (req, res) => {
  if (req.isAuthenticated()) {
    const userInitializer = req.app.locals.userInitializer;
    let needsWizard = false;

    if (userInitializer) {
      needsWizard = !(await userInitializer.isInitialized(req.user.username));
    }

    res.json({
      authenticated: true,
      needsWizard,
      user: {
        username: req.user.username,
        email: req.user.email,
        role: req.user.role
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;