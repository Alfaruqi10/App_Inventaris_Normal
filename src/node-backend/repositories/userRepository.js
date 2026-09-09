/**
 * UserRepository Interface
 * Kontrak untuk operasi data pengguna (Users).
 */
export class UserRepository {
  async findByEmail(email) { throw new Error("Method findByEmail() must be implemented."); }
  async createUser(userObj) { throw new Error("Method createUser() must be implemented."); }
  async updateUser(email, updates) { throw new Error("Method updateUser() must be implemented."); }
  async updatePassword(email, newHashedPassword) { throw new Error("Method updatePassword() must be implemented."); }
  async getAllUsers() { throw new Error("Method getAllUsers() must be implemented."); }
  async setUserStatus(email, status) { throw new Error("Method setUserStatus() must be implemented."); }
}
