const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
    ? 'http://localhost:3000/api' 
    : window.location.origin + '/api';

const api = {
    async getDb() {
        const response = await fetch(`${API_BASE}/db`);
        return response.json();
    },

    async createUser(user) {
        const response = await fetch(`${API_BASE}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        return response.json();
    },

    async updateUser(id, user) {
        const response = await fetch(`${API_BASE}/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        return response.json();
    },

    async deleteUser(id) {
        const response = await fetch(`${API_BASE}/users/${id}`, {
            method: 'DELETE'
        });
        return response.status === 204;
    },

    async deleteTenant(environment, tenant) {
        const response = await fetch(`${API_BASE}/tenants`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ environment, tenant })
        });
        return response.status === 204;
    },



    async launchIncognito(details) {
        const response = await fetch(`${API_BASE}/launch-incognito`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(details)
        });
        return response.json();
    }
};

window.api = api;

export { api };
