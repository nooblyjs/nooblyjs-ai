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

    async saveActivityToServer() {
        try {
            const response = await fetch('/applications/wiki/api/activity', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    recent: this.app.data.recent,
                    starred: this.app.data.starred
                })
            });

            if (!response.ok) {
                throw new Error('Failed to save activity data');
            }
        } catch (error) {
            console.error('Error saving activity to server:', error);
        }
    },

    async loadActivityFromServer() {
        try {
            const response = await fetch('/applications/wiki/api/activity');

            // Handle unauthenticated users gracefully
            if (response.status === 401) {
                this.app.data.recent = [];
                this.app.data.starred = [];
                return;
            }

            if (response.ok) {
                const data = await response.json();
                this.app.data.recent = data.recent || [];
                this.app.data.starred = data.starred || [];
            }
        } catch (error) {
            console.error('Error loading activity from server:', error);
            this.app.data.recent = [];
            this.app.data.starred = [];
        }
    },

    async loadUserActivity() {
        try {
            await this.loadActivityFromServer();

            const response = await fetch('/applications/wiki/api/user/activity');
            if (response.ok) {
                this.app.userActivity = await response.json();

                if (this.app.userActivity.recent) {
                    this.app.data.recent = this.app.userActivity.recent;
                }
                if (this.app.userActivity.starred) {
                    this.app.data.starred = this.app.userActivity.starred;
                }
            } else {
                this.app.userActivity = { starred: [], recent: [] };
            }
        } catch (error) {
            console.error('Error loading user activity:', error);
            this.app.userActivity = { starred: [], recent: [] };
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
        // No profile display in header - just ensure profile data is available
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

            } else if (data.allowsPublicAccess) {
                const wikiApp = document.getElementById('wikiApp');
                if (wikiApp) wikiApp.classList.remove('hidden');

                this.app.isPublicMode = true;
                this.app.showLoginButton();

                await this.app.loadInitialData();
                this.app.showHome();

            } else {
                // Redirect to login with return URL
                const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
                window.location.href = `/services/authservice/views/login.html?returnUrl=${returnUrl}`;
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            const wikiApp = document.getElementById('wikiApp');
            if (wikiApp) wikiApp.classList.remove('hidden');
            this.app.isPublicMode = true;
            this.app.showLoginButton();
            await this.app.loadInitialData();
            this.app.showHome();
        }
    },

    async handleLogout() {
        window.location.href = '/services/authservice/logout';
    }
}
