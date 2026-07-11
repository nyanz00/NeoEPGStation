<template>
    <v-select v-model="selectedUserId" :items="items" :label="label" dense hide-details class="user-selector" :menu-props="{ auto: true }"></v-select>
</template>

<script lang="ts">
import IUserApiModel from '@/model/api/user/IUserApiModel';
import container from '@/model/ModelContainer';
import { ActiveUserId, IActiveUserStorageModel } from '@/model/storage/user/IActiveUserStorageModel';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

interface SelectItem {
    text: string;
    value: ActiveUserId;
}

@Component({})
export default class UserSelector extends Vue {
    @Prop({ default: 'ユーザー' })
    public label!: string;

    @Prop({ default: true })
    public includeMaster!: boolean;

    @Prop({ default: false })
    public persistent!: boolean;

    @Prop({ default: undefined })
    public value!: ActiveUserId | undefined;

    public users: apid.User[] = [];
    private localUserId: ActiveUserId = null;

    private userApiModel: IUserApiModel = container.get<IUserApiModel>('IUserApiModel');
    private activeUserStorage: IActiveUserStorageModel = container.get<IActiveUserStorageModel>('IActiveUserStorageModel');

    get items(): SelectItem[] {
        const items: SelectItem[] =
            this.includeMaster === true
                ? [
                      {
                          text: 'master',
                          value: 'master',
                      },
                  ]
                : [];

        return items.concat(
            this.users.map(user => {
                return {
                    text: user.name,
                    value: user.id,
                };
            }),
        );
    }

    get selectedUserId(): ActiveUserId {
        return typeof this.value === 'undefined' ? this.localUserId : this.value;
    }

    set selectedUserId(value: ActiveUserId) {
        this.applySelectedUserId(value, true);
    }

    public async created(): Promise<void> {
        this.localUserId = this.activeUserStorage.getSavedValue().userId;
        await this.fetchUsers();
    }

    public getSelectedUser(): apid.User | null {
        const userId = this.selectedUserId;
        if (typeof userId !== 'number') {
            return null;
        }

        const user = this.users.find(u => u.id === userId);

        return typeof user === 'undefined' ? null : user;
    }

    public async fetchUsers(): Promise<void> {
        if (this.persistent === true && typeof this.value === 'undefined') {
            this.localUserId = this.activeUserStorage.getSavedValue().userId;
        }

        const result = await this.userApiModel.gets();
        this.users = result.users;

        if (this.isSelectableUserId(this.selectedUserId) === false) {
            this.applySelectedUserId(this.getFallbackUserId(), true);
        }
        this.$emit('loaded');
    }

    public selectUser(value: ActiveUserId): void {
        this.applySelectedUserId(value, true);
    }

    private applySelectedUserId(value: ActiveUserId, emit: boolean): void {
        this.localUserId = value;

        if (this.persistent === true) {
            this.activeUserStorage.tmp.userId = value;
            this.activeUserStorage.save();
        }

        if (emit === true) {
            this.$emit('input', value);
            this.$emit('change', value);
        }
    }

    private isSelectableUserId(value: ActiveUserId): boolean {
        if (value === 'master') {
            return this.includeMaster === true;
        }
        if (typeof value === 'number') {
            return this.users.some(user => user.id === value);
        }

        return false;
    }

    private getFallbackUserId(): ActiveUserId {
        const savedUserId = this.activeUserStorage.getSavedValue().userId;
        if (this.isSelectableUserId(savedUserId) === true) {
            return savedUserId;
        }
        if (this.users.length > 0) {
            return this.users[0].id;
        }

        return this.includeMaster === true ? 'master' : null;
    }
}
</script>

<style lang="sass" scoped>
.user-selector
    max-width: 150px
</style>
