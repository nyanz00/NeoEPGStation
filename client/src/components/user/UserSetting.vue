<template>
    <div class="user-setting">
        <UserSelector
            ref="userSelector"
            class="setting-user-selector"
            label="現在のユーザー"
            :includeMaster="false"
            :persistent="true"
            v-on:change="onChangeUser"
            v-on:loaded="onLoadedUsers"
        ></UserSelector>
        <div class="user-edit">
            <v-text-field v-model="editUserName" label="ユーザー名" dense hide-details clearable></v-text-field>
            <v-btn small color="primary" :disabled="isDisableUpdateUser" v-on:click="updateUser">変更</v-btn>
        </div>
        <div class="user-add">
            <v-text-field v-model="newUserName" label="新規ユーザー名" dense hide-details clearable></v-text-field>
            <v-btn small color="primary" :disabled="newUserName.trim().length === 0" v-on:click="addUser">追加</v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import IUserApiModel from '@/model/api/user/IUserApiModel';
import container from '@/model/ModelContainer';
import { IActiveUserStorageModel } from '@/model/storage/user/IActiveUserStorageModel';
import { Component, Vue } from 'vue-property-decorator';
import UserSelector from './UserSelector.vue';
import * as apid from '../../../../api';

@Component({
    components: {
        UserSelector,
    },
})
export default class UserSetting extends Vue {
    public newUserName: string = '';
    public editUserName: string = '';
    public currentUserName: string = '';
    public currentUserId: apid.UserId | null = null;

    private userApiModel: IUserApiModel = container.get<IUserApiModel>('IUserApiModel');
    private activeUserStorage: IActiveUserStorageModel = container.get<IActiveUserStorageModel>('IActiveUserStorageModel');

    get isDisableUpdateUser(): boolean {
        return this.currentUserId === null || this.editUserName.trim().length === 0 || this.currentUserName === this.editUserName.trim();
    }

    public async addUser(): Promise<void> {
        const name = this.newUserName.trim();
        if (name.length === 0) {
            return;
        }

        const userId = await this.userApiModel.add({ name });
        this.activeUserStorage.tmp.userId = userId;
        this.activeUserStorage.save();
        this.newUserName = '';
        await (this.$refs.userSelector as UserSelector).fetchUsers();
        (this.$refs.userSelector as UserSelector).selectUser(userId);
        this.syncEditUserName();
    }

    public async updateUser(): Promise<void> {
        const selectedUser = this.getSelectedUser();
        const name = this.editUserName.trim();
        if (selectedUser === null || this.currentUserId === null || name.length === 0) {
            return;
        }

        await this.userApiModel.update(this.currentUserId, { name });
        await (this.$refs.userSelector as UserSelector).fetchUsers();
        this.syncEditUserName();
    }

    public onChangeUser(): void {
        this.syncEditUserName();
    }

    public onLoadedUsers(): void {
        this.syncEditUserName();
    }

    public syncEditUserName(): void {
        const selectedUser = this.getSelectedUser();
        this.currentUserId = selectedUser === null ? null : selectedUser.id;
        this.currentUserName = selectedUser === null ? '' : selectedUser.name;
        this.editUserName = this.currentUserName;
    }

    private getSelectedUser(): apid.User | null {
        if (typeof this.$refs.userSelector === 'undefined') {
            return null;
        }

        return (this.$refs.userSelector as UserSelector).getSelectedUser();
    }
}
</script>

<style lang="sass" scoped>
.user-setting
    min-width: 420px
    max-width: 520px
    display: flex
    flex-direction: column
    gap: 20px

.user-add
    display: grid
    grid-template-columns: minmax(260px, 1fr) 80px
    column-gap: 14px
    align-items: center
    margin-top: 2px

.user-edit
    display: grid
    grid-template-columns: minmax(260px, 1fr) 80px
    column-gap: 14px
    align-items: center
    margin-top: 8px

    .v-btn
        min-width: 80px
</style>

<style lang="sass">
.user-setting
    .setting-user-selector.user-selector
        max-width: 320px
        margin-bottom: 8px
</style>
