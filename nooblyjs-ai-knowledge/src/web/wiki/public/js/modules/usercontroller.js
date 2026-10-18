import { clipboardPasteHandler } from "./clipboardPasteHandler.js";

export const userController = {

    init(app) {
        this.app = app;
    },

    // Activity tracking methods
    ensureActivityData() {
        if (!this.app.data.recent) {
            this.app.data.recent = [];
        }
        if (!this.app.data.starred) {
            this.app.data.starred = [];
        }
    },

    async loadUserActivity() {
        try {
            // Activity is space-scoped — ask for the current space's activity.
            const sp = this.app?.currentSpace?.name;
            const qs = sp ? `?space=${encodeURIComponent(sp)}` : '';
            const response = await fetch(`/applications/wiki/api/user/activity${qs}`);
            if (response.ok) {
                this.app.userActivity = await response.json();

                if (this.app.userActivity.recent) {
                    this.app.data.recent = this.app.userActivity.recent;
                }
                if (this.app.userActivity.starred) {
                    this.app.data.starred = this.app.userActivity.starred;
                }
            } else {
                // Unauthenticated / no data — start clean.
                this.app.userActivity = { starred: [], recent: [] };
                this.app.data.recent = [];
                this.app.data.starred = [];
            }
        } catch (error) {
            console.error('Error loading user activity:', error);
            this.app.userActivity = { starred: [], recent: [] };
            this.app.data.recent = [];
            this.app.data.starred = [];
        }
    },

    // User Profile - header display only
    async loadUserProfile() {
        try {
            const response = await fetch('/applications/wiki/api/profile');

            if (response.ok) {
                const profileData = await response.json();

                if (!this.app.userProfile) {
                    this.app.userProfile = profileData;
                } else {
                    this.app.userProfile = {
                        ...this.app.userProfile,
                        ...profileData,
                        name: this.app.userProfile.name,
                        email: this.app.userProfile.email || profileData.email,
                        role: this.app.userProfile.role
                    };
                }
                this.updateUserProfileUI();
            } else {
                if (!this.app.userProfile) {
                    this.app.userProfile = { name: 'User', email: '', role: 'user' };
                    this.updateUserProfileUI();
                }
            }
        } catch (error) {
            console.error('Error loading user profile:', error);
            if (!this.app.userProfile) {
                this.app.userProfile = { name: 'User', email: '', role: 'user' };
                this.updateUserProfileUI();
            }
        }
    },

    updateUserProfileUI() {
        const profile = this.app.userProfile;
        if (!profile) return;

        const nameEl = document.getElementById('userName');
        const avatarEl = document.getElementById('userAvatar');

        const display = profile.email || profile.name || 'User';
        if (nameEl) nameEl.textContent = display;

        if (avatarEl) {
            const source = profile.name || profile.email || 'U';
            const initials = source
                .replace(/@.*$/, '')
                .split(/[\s._-]+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(s => s[0].toUpperCase())
                .join('') || 'U';
            avatarEl.textContent = initials;

            // Uploaded profile picture covers the initials when one exists;
            // a failed load removes the img and the initials show through.
            if (profile.email) {
                const img = document.createElement('img');
                img.alt = '';
                img.src = this.avatarSrc(profile.email);
                img.addEventListener('error', () => img.remove());
                avatarEl.appendChild(img);
            }
        }
    },

    /** URL of the user's uploaded profile picture (404s if none uploaded). */
    avatarSrc(email) {
        const version = this.app?.userProfile?.avatarVersion;
        return `/applications/wiki/avatars/${encodeURIComponent(email)}${version ? `?v=${version}` : ''}`;
    },

    // Authentication methods
    async checkAuth() {
        try {
            const response = await fetch('/api/auth/check');
            const data = await response.json();

            if (data.authenticated) {
                if (data.user) {
                    this.app.userProfile = {
                        id: data.user.id,
                        name: data.user.name || 'User',
                        email: data.user.email || '',
                        role: data.user.role || 'user'
                    };
                    this.updateUserProfileUI();
                }

                const wikiApp = document.getElementById('wikiApp');
                if (wikiApp) wikiApp.classList.remove('hidden');

                if (data.needsWizard) {
                    window.location.href = '/wizard';
                    return;
                }

                await this.app.loadInitialData();
                this.app.showHome();
                this.startAuthRefresh();

            } else if (data.allowsPublicAccess) {
                const wikiApp = document.getElementById('wikiApp');
                if (wikiApp) wikiApp.classList.remove('hidden');

                this.app.isPublicMode = true;
                this.app.showLoginButton();

                await this.app.loadInitialData();
                this.app.showHome();
                this.startAuthRefresh();

            } else {
                // Redirect to login with return URL
                const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
                window.location.href = `/services/authservice/views/login.html?returnUrl=${returnUrl}`;
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            // Redirect to login on error
            const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/services/authservice/views/login.html?returnUrl=${returnUrl}`;
        }
    },

    /**
     * Background poll that re-checks the session every 5 minutes. If the
     * server says the session is no longer valid (and public access isn't
     * granted) we bounce to the login page so a user who's been idle
     * doesn't keep clicking on a dead session. Idempotent — only one timer
     * runs per page.
     */
    startAuthRefresh(intervalMinutes = 5) {
        if (this._authRefreshTimer) return;
        const ms = Math.max(1, intervalMinutes) * 60 * 1000;
        this._authRefreshTimer = setInterval(() => this._refreshAuth(), ms);
    },

    async _refreshAuth() {
        if (this._authRefreshing) return;
        this._authRefreshing = true;
        try {
            const response = await fetch('/api/auth/check', { cache: 'no-store' });
            // A non-2xx is treated like a network blip — leave the user where
            // they are and try again next tick. Only an explicit "session is
            // gone AND public access is not allowed" triggers the redirect.
            if (!response.ok) return;
            const data = await response.json();
            if (!data.authenticated && !data.allowsPublicAccess) {
                const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
                window.location.href = `/services/authservice/views/login.html?returnUrl=${returnUrl}`;
            }
        } catch (err) {
            console.warn('[Auth] Periodic check failed:', err);
        } finally {
            this._authRefreshing = false;
        }
    },

    async handleLogout() {
        window.location.href = '/services/authservice/logout';
    }
}
