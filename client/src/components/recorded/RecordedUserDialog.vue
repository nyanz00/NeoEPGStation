<template>
    <v-dialog v-model="dialogModel" max-width="420" scrollable>
        <v-card>
            <div class="pa-4 pb-0">
                <div class="text--primary mb-3">{{ recordedItem.name }} のユーザーを変更</div>
                <v-select v-model="selectedUserId" :items="items" label="ユーザー" dense hide-details :menu-props="{ auto: true }"></v-select>
            </div>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" text v-on:click="dialogModel = false">キャンセル</v-btn>
                <v-btn color="primary" text :disabled="selectedUserId === null" v-on:click="updateUser">変更</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IUserApiModel from '@/model/api/user/IUserApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

interface SelectItem {
    text: string;
    value: apid.UserId;
}

@Component({})
export default class RecordedUserDialog extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    @Prop({ required: true })
    public isOpen!: boolean;

    public users: apid.User[] = [];
    public selectedUserId: apid.UserId | null = null;

    private recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private userApiModel = container.get<IUserApiModel>('IUserApiModel');
    private snackbarState = container.get<ISnackbarState>('ISnackbarState');

    get dialogModel(): boolean {
        return this.isOpen;
    }

    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    get items(): SelectItem[] {
        return this.users.map(user => {
            return {
                text: user.name,
                value: user.id,
            };
        });
    }

    @Watch('isOpen', { immediate: true })
    public async onChangeState(newState: boolean): Promise<void> {
        if (newState !== true) {
            return;
        }

        await this.init();
    }

    public async updateUser(): Promise<void> {
        if (this.selectedUserId === null) {
            return;
        }

        try {
            await this.recordedApiModel.updateUser(this.recordedItem.id, {
                userId: this.selectedUserId,
            });
            this.recordedItem.userId = this.selectedUserId;
            this.dialogModel = false;
            this.snackbarState.open({
                color: 'success',
                text: 'ユーザー変更に成功',
            });
            this.$emit('updated', this.selectedUserId);
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: 'ユーザー変更に失敗',
            });
            console.error(err);
        }
    }

    private async init(): Promise<void> {
        const result = await this.userApiModel.gets();
        this.users = result.users;

        if (typeof this.recordedItem.userId === 'number') {
            this.selectedUserId = this.recordedItem.userId;
            return;
        }

        this.selectedUserId = this.users.length === 0 ? null : this.users[0].id;
    }
}
</script>
